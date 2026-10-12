// Account helpers for Settings > Login (SPEC AU-09, AU-10, GEN-08, GEN-17): password change and set, the 6-digit login
// method confirmation code, 2FA disable and recovery code regeneration.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditLog, emailOutbox, rateLimitBuckets, twoFactorRecoveryCodes, users, verificationCodes } from "@/db/schema";
import { changePassword, INCORRECT_CURRENT_PASSWORD_MESSAGE } from "@/lib/auth/flows/password";
import { checkLoginMethodConfirmation, sendLoginMethodCode, verifyLoginMethodCode } from "@/lib/auth/flows/login-method-code";
import {
  beginTwoFactorEnrollment,
  consumeRecoveryCode,
  disableTwoFactor,
  enableTwoFactor,
  regenerateRecoveryCodes,
  remainingRecoveryCodes,
} from "@/lib/auth/flows/two-factor";
import { createSessionRecord, lookupSession } from "@/lib/auth/session";
import { totpCode, totpStep } from "@/lib/auth/totp";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { nowMs, resetFakeTime, setFakeNow } from "@/lib/time/now";
import { createUser } from "../factories";
import { useTestDb } from "../helpers/db";

const t = useTestDb();

beforeEach(async () => {
  resetFakeTime();
  await t.db.delete(rateLimitBuckets);
});

describe("changePassword (AU-10)", () => {
  it("requires the current password, revokes other sessions and audits", async () => {
    const u = await createUser(t.db, { passwordHash: await hashPassword("old-password1") });
    const keep = await createSessionRecord(t.db, u.id);
    const other = await createSessionRecord(t.db, u.id);
    await expect(changePassword({ userId: u.id, currentPassword: "nope", newPassword: "new-password1", db: t.db })).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { currentPassword: [INCORRECT_CURRENT_PASSWORD_MESSAGE] },
    });
    await expect(changePassword({ userId: u.id, currentPassword: "old-password1", newPassword: "short", db: t.db })).rejects.toMatchObject({
      code: "validation",
    });
    await changePassword({ userId: u.id, currentPassword: "old-password1", newPassword: "new-password1", keepSessionId: keep.session.id, db: t.db });
    const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(await verifyPassword("new-password1", row!.passwordHash)).toBe(true);
    expect(await lookupSession(t.db, keep.token)).not.toBeNull();
    expect(await lookupSession(t.db, other.token)).toBeNull();
    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.password_changed"), eq(auditLog.targetId, u.id)));
    expect(audits[0]?.details).toMatchObject({ via: "change" });
  });

  it("lets OAuth-only accounts set a first password without a current one", async () => {
    const u = await createUser(t.db, { passwordHash: null });
    await changePassword({ userId: u.id, newPassword: "first-password1", db: t.db });
    const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(await verifyPassword("first-password1", row!.passwordHash)).toBe(true);
  });
});

describe("login method confirmation code (AU-10, GEN-08)", () => {
  it("emails a 6-digit code stored as an HMAC, accepts it once and expires after 10 minutes", async () => {
    const u = await createUser(t.db, { email: "code@example.com" });
    setFakeNow("2034-01-01T00:00:00Z");
    await sendLoginMethodCode(u.id, { db: t.db, defer: false });
    const [mail] = await t.db.select().from(emailOutbox).where(and(eq(emailOutbox.relatedUserId, u.id), eq(emailOutbox.template, "auth.login_method_code")));
    const code = /\b(\d{6})\b/.exec(mail!.text)![1]!;
    const [row] = await t.db.select().from(verificationCodes).where(eq(verificationCodes.contextId, u.id));
    expect(row?.codeHash).not.toContain(code);
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);

    await expect(verifyLoginMethodCode(u.id, "000000", { db: t.db })).rejects.toMatchObject({ code: "validation" });
    const { confirmation } = await verifyLoginMethodCode(u.id, code, { db: t.db });
    expect(await checkLoginMethodConfirmation(u.id, confirmation)).toBe(true);
    expect(await checkLoginMethodConfirmation("00000000-0000-4000-8000-000000000000", confirmation)).toBe(false);
    await expect(verifyLoginMethodCode(u.id, code, { db: t.db })).rejects.toMatchObject({ code: "validation" });
    setFakeNow("2034-01-01T00:10:01Z");
    expect(await checkLoginMethodConfirmation(u.id, confirmation)).toBe(false);
    setFakeNow("2034-01-01T00:00:00Z");

    await sendLoginMethodCode(u.id, { db: t.db, defer: false });
    const mails = await t.db.select().from(emailOutbox).where(and(eq(emailOutbox.relatedUserId, u.id), eq(emailOutbox.template, "auth.login_method_code")));
    const second = /\b(\d{6})\b/.exec(mails.at(-1)!.text)![1]!;
    setFakeNow("2034-01-01T00:10:01Z");
    await expect(verifyLoginMethodCode(u.id, second, { db: t.db })).rejects.toMatchObject({ code: "validation" });
  });

  it("locks a code after 5 wrong tries", async () => {
    const u = await createUser(t.db);
    await sendLoginMethodCode(u.id, { db: t.db, defer: false });
    const [mail] = await t.db.select().from(emailOutbox).where(and(eq(emailOutbox.relatedUserId, u.id), eq(emailOutbox.template, "auth.login_method_code")));
    const code = /\b(\d{6})\b/.exec(mail!.text)![1]!;
    for (let i = 0; i < 5; i++) await expect(verifyLoginMethodCode(u.id, "111111", { db: t.db })).rejects.toBeTruthy();
    await expect(verifyLoginMethodCode(u.id, code, { db: t.db })).rejects.toMatchObject({ code: "validation" });
  });
});

describe("2FA management (AU-09)", () => {
  async function enrolled() {
    const u = await createUser(t.db, { passwordHash: await hashPassword("pw-1234567") });
    const { secretBase32 } = beginTwoFactorEnrollment(u);
    const { recoveryCodes } = await enableTwoFactor({ user: u, secretBase32, code: totpCode(secretBase32, totpStep(nowMs())), db: t.db });
    const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
    return { user: row!, secretBase32, recoveryCodes };
  }

  it("stores recovery codes hashed and regenerates them (old ones stop working)", async () => {
    setFakeNow("2034-02-01T00:00:00Z");
    const { user, recoveryCodes } = await enrolled();
    const rows = await t.db.select().from(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, user.id));
    expect(rows).toHaveLength(10);
    for (const r of rows) for (const c of recoveryCodes) expect(r.codeHash).not.toContain(c.replace("-", ""));
    expect(await remainingRecoveryCodes(t.db, user.id)).toBe(10);
    const fresh = await regenerateRecoveryCodes({ user, db: t.db });
    expect(fresh).toHaveLength(10);
    expect(await consumeRecoveryCode(t.db, user.id, recoveryCodes[0]!)).toBe(false);
    expect(await consumeRecoveryCode(t.db, user.id, fresh[0]!)).toBe(true);
    expect(await remainingRecoveryCodes(t.db, user.id)).toBe(9);
  });

  it("disables with the password and a current code", async () => {
    setFakeNow("2034-03-01T00:00:00Z");
    const { user, secretBase32 } = await enrolled();
    setFakeNow("2034-03-01T00:01:00Z");
    const code = totpCode(secretBase32, totpStep(nowMs()));
    await expect(disableTwoFactor({ user, code, password: "wrong", db: t.db })).rejects.toMatchObject({ code: "validation", fieldErrors: { password: ["Incorrect password."] } });
    await disableTwoFactor({ user, code, password: "pw-1234567", db: t.db });
    const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({ twoFactorEnabled: false, twoFactorSecretEnc: null });
    expect(await remainingRecoveryCodes(t.db, user.id)).toBe(0);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.targetId, user.id));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["user.two_factor_enabled", "user.two_factor_disabled"]));
  });
});
