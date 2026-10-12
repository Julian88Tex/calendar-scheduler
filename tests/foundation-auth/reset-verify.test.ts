// Password reset and email verification (SPEC AU-07, AU-08, AU-14, GEN-08): emails land in the outbox with the link,
// opening the link (GET, peek) consumes nothing, only the POST does, links work once, expire on time, and the reset
// logs the user in and revokes their other sessions.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);
vi.mock("next/cache", async () => (await import("./_request")).nextCacheMock);

const { auditLog, authTokens, emailOutbox, rateLimitBuckets, sessions, users } = await import("@/db/schema");
const { sendResetLink } = await import("@/app/(auth)/forgot-password/actions");
const { submitNewPassword } = await import("@/app/(auth)/reset-password/[token]/actions");
const { confirmEmail } = await import("@/app/(auth)/verify-email/[token]/actions");
const { peekPasswordResetToken, requestPasswordReset, resetPassword, RESET_LINK_EXPIRED_MESSAGE } = await import("@/lib/auth/password-reset");
const { inspectEmailVerificationToken, peekEmailVerificationToken, sendVerificationEmail, verifyEmailToken } = await import("@/lib/auth/verify-email");
const { createSessionRecord, lookupSession, SESSION_COOKIE } = await import("@/lib/auth/session");
const { hashPassword, hashToken, verifyPassword } = await import("@/lib/crypto");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const { createUser } = await import("../factories");
const { expectRedirect, form, jar, resetRequest } = await import("./_request");

const t = useTestDb();

beforeEach(async () => {
  resetRequest();
  resetFakeTime();
  await t.db.delete(rateLimitBuckets);
});

async function lastEmail(userId: string, template: string) {
  const rows = await t.db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.relatedUserId, userId), eq(emailOutbox.template, template)));
  return rows.at(-1) ?? null;
}

function tokenFrom(html: string, path: string): string {
  const m = new RegExp(`${path}/([A-Za-z0-9_-]+)`).exec(html);
  if (!m?.[1]) throw new Error(`no ${path} link in email`);
  return m[1];
}

describe("forgot password (AU-07)", () => {
  it("always answers the same way and only emails existing accounts", async () => {
    const u = await createUser(t.db, { email: "Reset.Me@example.com", passwordHash: await hashPassword("old-password1") });
    const known = await sendResetLink(null, form({ email: "reset.me@EXAMPLE.com" }));
    const unknown = await sendResetLink(null, form({ email: "ghost@example.com" }));
    expect(known).toEqual({ ok: true, data: { message: "If an account exists for reset.me@EXAMPLE.com, we sent a link to reset your password." } });
    expect(unknown).toEqual({ ok: true, data: { message: "If an account exists for ghost@example.com, we sent a link to reset your password." } });
    const mail = await lastEmail(u.id, "auth.reset_password");
    expect(mail?.toAddresses).toEqual(["Reset.Me@example.com"]);
    expect(mail?.subject).toBe("Reset your Kairos password");
    expect(mail?.text).toContain("expires in 60 minutes");
    const ghostMail = await t.db.select().from(emailOutbox).where(eq(emailOutbox.template, "auth.reset_password"));
    expect(ghostMail.every((m) => !m.toAddresses.includes("ghost@example.com"))).toBe(true);
    // The token is stored only as its SHA-256.
    const token = tokenFrom(mail!.html, "/reset-password");
    const rows = await t.db.select().from(authTokens).where(eq(authTokens.userId, u.id));
    expect(rows.map((r) => r.tokenHash)).toContain(hashToken(token));
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
  });

  it("limits reset emails to 5 per address per hour", async () => {
    await createUser(t.db, { email: "limit@example.com" });
    setFakeNow("2032-01-01T08:00:00Z");
    for (let i = 0; i < 5; i++) expect((await sendResetLink(null, form({ email: "limit@example.com" })))?.ok).toBe(true);
    const sixth = await sendResetLink(null, form({ email: "limit@example.com" }));
    expect(sixth).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    setFakeNow("2032-01-01T09:00:01Z");
    expect((await sendResetLink(null, form({ email: "limit@example.com" })))?.ok).toBe(true);
  });
});

describe("reset link (AU-07, GEN-08)", () => {
  it("is not consumed by opening it, works once from the form, logs in and revokes other sessions", async () => {
    const u = await createUser(t.db, { email: "rita@example.com", passwordHash: await hashPassword("old-password1") });
    const other = await createSessionRecord(t.db, u.id);
    await requestPasswordReset("rita@example.com", { db: t.db, defer: false });
    const token = tokenFrom((await lastEmail(u.id, "auth.reset_password"))!.html, "/reset-password");

    // GET (peek) twice: still valid.
    expect(await peekPasswordResetToken(token)).toEqual({ email: "rita@example.com" });
    expect(await peekPasswordResetToken(token)).toEqual({ email: "rita@example.com" });

    const mismatch = await submitNewPassword(null, form({ token, password: "brand-new1", confirmPassword: "brand-new2" }));
    expect(mismatch).toMatchObject({ ok: false, error: { code: "validation", fieldErrors: { confirmPassword: ["Passwords don't match"] } } });

    const target = await expectRedirect(submitNewPassword(null, form({ token, password: "brand-new1", confirmPassword: "brand-new1" })));
    expect(target).toBe("/app/scheduling");
    const [stored] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(await verifyPassword("brand-new1", stored!.passwordHash)).toBe(true);
    expect(await lookupSession(t.db, other.token)).toBeNull();
    expect((await lookupSession(t.db, jar.get(SESSION_COOKIE)))?.user.id).toBe(u.id);
    const changed = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.password_changed"), eq(auditLog.targetId, u.id)));
    expect(changed).toHaveLength(1);

    // Reuse fails with the AU-07 message, from the GET and the POST.
    expect(await peekPasswordResetToken(token)).toBeNull();
    const again = await submitNewPassword(null, form({ token, password: "another-one1", confirmPassword: "another-one1" }));
    expect(again).toMatchObject({ ok: false, error: { code: "not_found", message: RESET_LINK_EXPIRED_MESSAGE } });
    expect(RESET_LINK_EXPIRED_MESSAGE).toBe("This link has expired. Request a new one.");
  });

  it("expires after 60 minutes and lets OAuth-only accounts set a password (verifying the email)", async () => {
    const u = await createUser(t.db, { email: "oauth.only@example.com", passwordHash: null, overrides: { emailVerifiedAt: null } });
    setFakeNow("2032-02-01T10:00:00Z");
    await requestPasswordReset(u.email, { db: t.db, defer: false });
    const token = tokenFrom((await lastEmail(u.id, "auth.reset_password"))!.html, "/reset-password");
    setFakeNow("2032-02-01T11:00:01Z");
    expect(await peekPasswordResetToken(token)).toBeNull();
    await expect(resetPassword(token, "whatever-1", { db: t.db })).rejects.toThrow(RESET_LINK_EXPIRED_MESSAGE);

    setFakeNow("2032-02-01T12:00:00Z");
    await requestPasswordReset(u.email, { db: t.db, defer: false });
    const fresh = tokenFrom((await lastEmail(u.id, "auth.reset_password"))!.html, "/reset-password");
    setFakeNow("2032-02-01T12:59:00Z");
    expect(await resetPassword(fresh, "first-password1", { db: t.db })).toEqual({ userId: u.id });
    const [stored] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(await verifyPassword("first-password1", stored!.passwordHash)).toBe(true);
    expect(stored?.emailVerifiedAt).not.toBeNull();
  });

  it("a successful reset invalidates the user's other outstanding reset links", async () => {
    const u = await createUser(t.db, { email: "two.links@example.com" });
    await requestPasswordReset(u.email, { db: t.db, defer: false });
    const first = tokenFrom((await lastEmail(u.id, "auth.reset_password"))!.html, "/reset-password");
    await requestPasswordReset(u.email, { db: t.db, defer: false });
    const second = tokenFrom((await lastEmail(u.id, "auth.reset_password"))!.html, "/reset-password");
    expect(first).not.toBe(second);
    await resetPassword(second, "new-password1", { db: t.db });
    expect(await peekPasswordResetToken(first)).toBeNull();
  });
});

describe("email verification (AU-08, GEN-08)", () => {
  it("sends the link, is not consumed by the GET, verifies on POST and only once", async () => {
    const u = await createUser(t.db, { email: "vera@example.com", overrides: { emailVerifiedAt: null } });
    await sendVerificationEmail(u.id, { db: t.db, defer: false });
    const mail = await lastEmail(u.id, "auth.verify_email");
    expect(mail?.subject).toBe("Verify your email");
    expect(mail?.text).toContain("expires in 24 hours");
    const token = tokenFrom(mail!.html, "/verify-email");

    expect(await peekEmailVerificationToken(token)).toEqual({ email: "vera@example.com" });
    expect(await peekEmailVerificationToken(token)).toEqual({ email: "vera@example.com" });
    expect((await t.db.select().from(users).where(eq(users.id, u.id)))[0]?.emailVerifiedAt).toBeNull();

    expect(await confirmEmail(null, form({ token }))).toEqual({ ok: true, data: { verified: true } });
    expect((await t.db.select().from(users).where(eq(users.id, u.id)))[0]?.emailVerifiedAt).not.toBeNull();
    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.email_verified"), eq(auditLog.targetId, u.id)));
    expect(audits).toHaveLength(1);

    const again = await confirmEmail(null, form({ token }));
    expect(again).toMatchObject({ ok: false, error: { code: "not_found", message: "This link has expired. Request a new one." } });
    // Already verified: no new email.
    await sendVerificationEmail(u.id, { db: t.db, defer: false });
    const all = await t.db.select().from(emailOutbox).where(and(eq(emailOutbox.relatedUserId, u.id), eq(emailOutbox.template, "auth.verify_email")));
    expect(all).toHaveLength(1);
  });

  it("expires after 24 hours and never verifies an address that changed since", async () => {
    const u = await createUser(t.db, { email: "old@example.com", overrides: { emailVerifiedAt: null } });
    setFakeNow("2032-03-01T00:00:00Z");
    await sendVerificationEmail(u.id, { db: t.db, defer: false });
    const token = tokenFrom((await lastEmail(u.id, "auth.verify_email"))!.html, "/verify-email");
    setFakeNow("2032-03-02T00:00:01Z");
    expect(await peekEmailVerificationToken(token)).toBeNull();

    setFakeNow("2032-03-03T00:00:00Z");
    await sendVerificationEmail(u.id, { db: t.db, defer: false });
    const fresh = tokenFrom((await lastEmail(u.id, "auth.verify_email"))!.html, "/verify-email");
    await t.db.update(users).set({ email: "new@example.com", emailNormalized: "new@example.com" }).where(eq(users.id, u.id));
    expect(await inspectEmailVerificationToken(fresh, t.db)).toBeNull();
    await expect(verifyEmailToken(fresh, { db: t.db })).rejects.toThrow("This link has expired. Request a new one.");
    expect((await t.db.select().from(users).where(eq(users.id, u.id)))[0]?.emailVerifiedAt).toBeNull();
  });

  it("limits verification emails to 5 per address per hour", async () => {
    const u = await createUser(t.db, { email: "spam.me@example.com", overrides: { emailVerifiedAt: null } });
    setFakeNow("2032-04-01T00:00:00Z");
    for (let i = 0; i < 5; i++) await sendVerificationEmail(u.id, { db: t.db, defer: false });
    await expect(sendVerificationEmail(u.id, { db: t.db, defer: false })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("the banner action resends for the signed-in user", async () => {
    const u = await createUser(t.db, { email: "banner@example.com", overrides: { emailVerifiedAt: null } });
    const { token } = await createSessionRecord(t.db, u.id);
    jar.set(SESSION_COOKIE, token);
    const { resendVerificationEmailResult } = await import("@/lib/auth/actions");
    expect(await resendVerificationEmailResult()).toEqual({ ok: true, data: { email: "banner@example.com" } });
    expect(await lastEmail(u.id, "auth.verify_email")).not.toBeNull();
    const sessionsLeft = await t.db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(sessionsLeft).toHaveLength(1);
  });
});
