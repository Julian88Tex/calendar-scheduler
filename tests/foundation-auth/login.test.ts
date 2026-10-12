// Login, logout and the second factor (SPEC AU-04, AU-05, AU-06, AU-09, AU-14, GEN-17), through the real actions and
// the logout route with a fake request scope.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);
vi.mock("next/cache", async () => (await import("./_request")).nextCacheMock);

const { auditLog, rateLimitBuckets, sessions, users } = await import("@/db/schema");
const { logIn } = await import("@/app/(auth)/login/actions");
const { verifyTwoFactor } = await import("@/app/(auth)/login/two-factor/actions");
const { POST: logoutRoute } = await import("@/app/api/auth/logout/route");
const { authenticateWithPassword, INCORRECT_CREDENTIALS_MESSAGE } = await import("@/lib/auth/login");
const { SESSION_COOKIE, lookupSession } = await import("@/lib/auth/session");
const { beginTwoFactorEnrollment, enableTwoFactor, verifyUserTotp } = await import("@/lib/auth/flows/two-factor");
const { totpCode, totpStep } = await import("@/lib/auth/totp");
const crypto = await import("@/lib/crypto");
const { resetFakeTime, setFakeNow, nowMs } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const { createUser } = await import("../factories");
const { expectRedirect, form, jar, resetRequest } = await import("./_request");

const t = useTestDb();
const PASSWORD = "correct-horse1";
let passwordHash = "";

beforeEach(async () => {
  resetRequest();
  resetFakeTime();
  await t.db.delete(rateLimitBuckets);
  passwordHash ||= await crypto.hashPassword(PASSWORD);
});

async function user(opts: { email?: string; twoFactor?: boolean } = {}) {
  return createUser(t.db, { email: opts.email, passwordHash });
}

describe("logIn action (AU-04)", () => {
  it("logs in, sets the session cookie, audits user.login and honors a same-site ?next", async () => {
    const u = await user();
    const target = await expectRedirect(logIn(null, form({ email: u.email.toUpperCase(), password: PASSWORD, next: "/app/meetings?view=past" })));
    expect(target).toBe("/app/meetings?view=past");
    const session = await lookupSession(t.db, jar.get(SESSION_COOKIE));
    expect(session?.user.id).toBe(u.id);
    const [row] = await t.db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(row).toMatchObject({ ip: "203.0.113.7", userAgent: "vitest", twoFactorPending: false });
    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.login"), eq(auditLog.targetId, u.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toMatchObject({ method: "password" });
  });

  it("only follows same-site relative next paths", async () => {
    const u = await user();
    for (const next of ["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      resetRequest();
      expect(await expectRedirect(logIn(null, form({ email: u.email, password: PASSWORD, next })))).toBe("/app/scheduling");
    }
  });

  it("answers the same message for a wrong password, an unknown email and an OAuth-only account", async () => {
    const u = await user();
    const oauthOnly = await createUser(t.db, { passwordHash: null });
    for (const [email, password] of [
      [u.email, "wrong-password1"],
      ["nobody@example.com", PASSWORD],
      [oauthOnly.email, PASSWORD],
    ] as const) {
      const res = await logIn(null, form({ email, password }));
      expect(res).toMatchObject({ ok: false, error: { code: "unauthorized", message: INCORRECT_CREDENTIALS_MESSAGE } });
    }
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    const failed = await t.db.select().from(auditLog).where(eq(auditLog.action, "user.login_failed"));
    expect(failed.filter((a) => a.targetId === u.id)).toHaveLength(1);
    expect(failed.some((a) => (a.details as { email?: string }).email === "nobody@example.com")).toBe(true);
  });

  it("rejects the 11th failed login for an email within 15 minutes without checking the password (AU-14)", async () => {
    const u = await user();
    setFakeNow("2031-03-01T10:00:00Z");
    for (let i = 0; i < 10; i++) {
      resetRequest({ "x-forwarded-for": `192.0.2.${i + 1}` });
      expect(await logIn(null, form({ email: u.email, password: `wrong-${i}a` }))).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    }
    const spy = vi.spyOn(crypto, "verifyPassword");
    resetRequest({ "x-forwarded-for": "192.0.2.99" });
    const blocked = await logIn(null, form({ email: u.email, password: PASSWORD }));
    expect(blocked).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    if (blocked && !blocked.ok) expect(blocked.error.message).toMatch(/^Too many attempts\. Try again in \d+ minutes?\.$/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    // A new window opens after 15 minutes.
    setFakeNow("2031-03-01T10:15:01Z");
    expect(await expectRedirect(logIn(null, form({ email: u.email, password: PASSWORD })))).toBe("/app/scheduling");
  });

  it("limits failed logins per IP to 50 per 15 minutes", async () => {
    setFakeNow("2031-04-01T10:00:00Z");
    resetRequest({ "x-forwarded-for": "198.51.100.200" });
    for (let i = 0; i < 50; i++) {
      await authenticateWithPassword({ email: `ghost${i}@example.com`, password: "x1x1x1x1", meta: { ip: "198.51.100.200", userAgent: null }, db: t.db }).catch(() => undefined);
    }
    const u = await user();
    const err = await authenticateWithPassword({ email: u.email, password: PASSWORD, meta: { ip: "198.51.100.200", userAgent: null }, db: t.db }).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("rate_limited");
    const ok = await authenticateWithPassword({ email: u.email, password: PASSWORD, meta: { ip: "198.51.100.201", userAgent: null }, db: t.db });
    expect(ok.user.id).toBe(u.id);
  });

  it("clears the email window after a successful login", async () => {
    const u = await user();
    for (let i = 0; i < 9; i++) await logIn(null, form({ email: u.email, password: "nope-nope1" }));
    await expectRedirect(logIn(null, form({ email: u.email, password: PASSWORD })));
    resetRequest();
    for (let i = 0; i < 9; i++) {
      expect(await logIn(null, form({ email: u.email, password: "nope-nope1" }))).toMatchObject({ error: { code: "unauthorized" } });
    }
  });
});

describe("logout (AU-05)", () => {
  it("rejects cross-origin posts and revokes the session for same-origin ones", async () => {
    const u = await user();
    await expectRedirect(logIn(null, form({ email: u.email, password: PASSWORD })));
    const token = jar.get(SESSION_COOKIE)!;
    const cross = await logoutRoute(new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(cross.status).toBe(403);
    expect(await lookupSession(t.db, token)).not.toBeNull();

    const res = await logoutRoute(new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { origin: "http://localhost:3000" } }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    // Reusing the old cookie value is rejected.
    expect(await lookupSession(t.db, token)).toBeNull();
    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.logout"), eq(auditLog.targetId, u.id)));
    expect(audits).toHaveLength(1);
  });
});

describe("two-factor login (AU-09)", () => {
  it("enrolls, logs out, logs in with a valid code, fails with an invalid one, and uses a recovery code once", async () => {
    const u = await user();
    setFakeNow("2031-05-01T12:00:00Z");
    const { secretBase32, otpauthUri } = beginTwoFactorEnrollment(u);
    expect(otpauthUri).toContain(encodeURIComponent(u.email));
    const wrongFirst = await enableTwoFactor({ user: u, secretBase32, code: "000000", db: t.db }).catch((e: unknown) => e);
    expect((wrongFirst as { code?: string }).code).toBe("validation");
    const { recoveryCodes } = await enableTwoFactor({ user: u, secretBase32, code: totpCode(secretBase32, totpStep(nowMs())), db: t.db });
    expect(recoveryCodes).toHaveLength(10);
    const [stored] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(stored?.twoFactorEnabled).toBe(true);
    expect(stored?.twoFactorSecretEnc).toMatch(/^v1\./);
    expect(stored?.twoFactorSecretEnc).not.toContain(secretBase32);

    // Password step: a pending session that only reaches /login/two-factor.
    setFakeNow("2031-05-01T12:05:00Z");
    const target = await expectRedirect(logIn(null, form({ email: u.email, password: PASSWORD, next: "/app/meetings" })));
    expect(target).toBe("/login/two-factor?next=%2Fapp%2Fmeetings");
    const pendingToken = jar.get(SESSION_COOKIE)!;
    expect((await lookupSession(t.db, pendingToken))?.session.twoFactorPending).toBe(true);

    // Wrong code.
    const bad = await verifyTwoFactor(null, form({ method: "totp", code: "123456", next: "/app/meetings" }));
    expect(bad).toMatchObject({ ok: false, error: { code: "validation" } });
    if (bad && !bad.ok) expect(bad.error.fieldErrors?.code?.[0]).toMatch(/didn't work/);
    // Valid code completes the login.
    const code = totpCode(secretBase32, totpStep(nowMs()));
    expect(await expectRedirect(verifyTwoFactor(null, form({ method: "totp", code, next: "/app/meetings" })))).toBe("/app/meetings");
    // The pending token is replaced by a fresh, fully authenticated one.
    expect(await lookupSession(t.db, pendingToken)).toBeNull();
    const full = await lookupSession(t.db, jar.get(SESSION_COOKIE));
    expect(full?.user.id).toBe(u.id);
    expect(full?.session.twoFactorPending).toBe(false);
    const logins = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.login"), eq(auditLog.targetId, u.id)));
    expect(logins.at(-1)?.details).toMatchObject({ method: "password", twoFactor: "totp" });

    // The same code cannot be replayed.
    const [fresh] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(await verifyUserTotp(t.db, fresh!, code)).toBe(false);

    // Log out, log in again with a recovery code: works once.
    await logoutRoute(new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { origin: "http://localhost:3000" } }));
    resetRequest();
    await expectRedirect(logIn(null, form({ email: u.email, password: PASSWORD })));
    const recovery = recoveryCodes[3]!;
    expect(await expectRedirect(verifyTwoFactor(null, form({ method: "recovery", code: recovery.toUpperCase(), next: "/app/scheduling" })))).toBe("/app/scheduling");

    resetRequest();
    await expectRedirect(logIn(null, form({ email: u.email, password: PASSWORD })));
    const reused = await verifyTwoFactor(null, form({ method: "recovery", code: recovery, next: "/app/scheduling" }));
    expect(reused).toMatchObject({ ok: false, error: { code: "validation" } });
    expect((await lookupSession(t.db, jar.get(SESSION_COOKIE)))?.session.twoFactorPending).toBe(true);
  });

  it("allows 5 code attempts per session per 5 minutes (AU-14)", async () => {
    const u = await user();
    setFakeNow("2031-06-01T09:00:00Z");
    const { secretBase32 } = beginTwoFactorEnrollment(u);
    await enableTwoFactor({ user: u, secretBase32, code: totpCode(secretBase32, totpStep(nowMs())), db: t.db });
    setFakeNow("2031-06-01T09:02:00Z");
    await expectRedirect(logIn(null, form({ email: u.email, password: PASSWORD })));
    for (let i = 0; i < 5; i++) {
      expect(await verifyTwoFactor(null, form({ code: "000000" }))).toMatchObject({ ok: false, error: { code: "validation" } });
    }
    const limited = await verifyTwoFactor(null, form({ code: totpCode(secretBase32, totpStep(nowMs())) }));
    expect(limited).toMatchObject({ ok: false, error: { code: "rate_limited" } });
  });

  it("without a pending session the challenge refuses", async () => {
    const res = await verifyTwoFactor(null, form({ code: "123456" }));
    expect(res).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });
});
