// Regression tests from the adversarial review of foundation-auth (SPEC AU-02, AU-07, AU-09, AU-10, AU-11, AU-14,
// GEN-08):
// - login attempts are counted before the password check, so a burst of parallel guesses cannot exceed the window;
// - second factor guesses are limited per account across pending sessions, and a pending session expires;
// - signing in with a provider into an unverified account (pre-registered by someone else) drops the credentials
//   that were set before the address was proven (pre-account hijacking);
// - a reset link only works for the address it was sent to;
// - parallel guesses of a login method code are counted atomically.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);
vi.mock("next/cache", async () => (await import("./_request")).nextCacheMock);

const { emailOutbox, organizationInvitations, organizationMemberships, rateLimitBuckets, sessions, twoFactorRecoveryCodes, users, verificationCodes } =
  await import("@/db/schema");
const { authenticateWithPassword } = await import("@/lib/auth/login");
const { verifyTwoFactor } = await import("@/app/(auth)/login/two-factor/actions");
const { requirePendingTwoFactorSession } = await import("@/lib/auth/guards");
const { PENDING_TWO_FACTOR_TTL_MS, beginTwoFactorEnrollment, completeTwoFactorChallenge, enableTwoFactor } = await import(
  "@/lib/auth/flows/two-factor"
);
const { acceptInvitationWithOAuth, resolveOAuthLogin } = await import("@/lib/auth/flows/oauth-accounts");
const { sendLoginMethodCode, verifyLoginMethodCode } = await import("@/lib/auth/flows/login-method-code");
const { peekPasswordResetToken, requestPasswordReset, resetPassword, RESET_LINK_EXPIRED_MESSAGE } = await import("@/lib/auth/password-reset");
const { SESSION_COOKIE, createSessionRecord, lookupSession } = await import("@/lib/auth/session");
const { totpCode, totpStep } = await import("@/lib/auth/totp");
const { hashPassword, verifyPassword } = await import("@/lib/crypto");
const { nowMs, resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const { createInvitation, createUser } = await import("../factories");
const { expectRedirect, form, jar, resetRequest } = await import("./_request");

const t = useTestDb();
const PASSWORD = "correct-horse1";
let passwordHash = "";

beforeEach(async () => {
  resetRequest();
  resetFakeTime();
  await t.db.delete(rateLimitBuckets);
  passwordHash ||= await hashPassword(PASSWORD);
});

const errorCode = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason as { code?: string }).code : "ok");

describe("login attempt counting (AU-14)", () => {
  it("checks at most 10 passwords of a parallel burst against one email", async () => {
    const u = await createUser(t.db, { passwordHash });
    setFakeNow("2035-01-01T10:00:00Z");
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) =>
        authenticateWithPassword({ email: u.email, password: `wrong-${i}a`, meta: { ip: `192.0.2.${i + 1}`, userAgent: null }, db: t.db }),
      ),
    );
    const codes = results.map(errorCode);
    expect(codes.filter((c) => c === "unauthorized").length).toBeLessThanOrEqual(10);
    expect(codes.filter((c) => c === "rate_limited").length).toBeGreaterThanOrEqual(15);
    await expect(
      authenticateWithPassword({ email: u.email, password: PASSWORD, meta: { ip: "192.0.2.200", userAgent: null }, db: t.db }),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("checks at most 50 passwords of a parallel burst from one IP", async () => {
    setFakeNow("2035-01-02T10:00:00Z");
    const results = await Promise.allSettled(
      Array.from({ length: 70 }, (_, i) =>
        authenticateWithPassword({ email: `ghost${i}@example.com`, password: "x1x1x1x1", meta: { ip: "198.51.100.50", userAgent: null }, db: t.db }),
      ),
    );
    const codes = results.map(errorCode);
    expect(codes.filter((c) => c === "unauthorized").length).toBeLessThanOrEqual(50);
    expect(codes.filter((c) => c === "rate_limited").length).toBeGreaterThanOrEqual(20);
  });

  it("successful logins do not use up the IP window", async () => {
    const u = await createUser(t.db, { passwordHash });
    setFakeNow("2035-01-03T10:00:00Z");
    for (let i = 0; i < 52; i++) {
      const res = await authenticateWithPassword({ email: u.email, password: PASSWORD, meta: { ip: "198.51.100.77", userAgent: null }, db: t.db });
      expect(res.user.id).toBe(u.id);
    }
  });
});

describe("second factor hardening (AU-09, AU-14)", () => {
  async function enrolled() {
    const u = await createUser(t.db, { passwordHash });
    const { secretBase32 } = beginTwoFactorEnrollment(u);
    await enableTwoFactor({ user: u, secretBase32, code: totpCode(secretBase32, totpStep(nowMs())), db: t.db });
    const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
    return { user: row!, secretBase32 };
  }
  const meta = { ip: null, userAgent: null };

  it("limits guesses per account, so extra pending sessions do not add attempts", async () => {
    setFakeNow("2035-02-01T09:00:00Z");
    const { user, secretBase32 } = await enrolled();
    setFakeNow("2035-02-01T09:01:00Z");
    for (let s = 0; s < 2; s++) {
      const { session } = await createSessionRecord(t.db, user.id, { twoFactorPending: true });
      for (let i = 0; i < 5; i++) {
        await expect(
          completeTwoFactorChallenge({ sessionId: session.id, user, method: "totp", code: "000000", meta, db: t.db }),
        ).rejects.toMatchObject({ code: "validation" });
      }
    }
    const { session } = await createSessionRecord(t.db, user.id, { twoFactorPending: true });
    const valid = totpCode(secretBase32, totpStep(nowMs()));
    await expect(completeTwoFactorChallenge({ sessionId: session.id, user, method: "totp", code: valid, meta, db: t.db })).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("a successful second factor clears the account window", async () => {
    setFakeNow("2035-02-02T09:00:00Z");
    const { user, secretBase32 } = await enrolled();
    setFakeNow("2035-02-02T09:01:00Z");
    for (let s = 0; s < 2; s++) {
      const { session } = await createSessionRecord(t.db, user.id, { twoFactorPending: true });
      for (let i = 0; i < 4; i++) {
        await expect(
          completeTwoFactorChallenge({ sessionId: session.id, user, method: "totp", code: "000000", meta, db: t.db }),
        ).rejects.toMatchObject({ code: "validation" });
      }
    }
    const ok = await createSessionRecord(t.db, user.id, { twoFactorPending: true });
    await completeTwoFactorChallenge({ sessionId: ok.session.id, user, method: "totp", code: totpCode(secretBase32, totpStep(nowMs())), meta, db: t.db });
    const next = await createSessionRecord(t.db, user.id, { twoFactorPending: true });
    for (let i = 0; i < 5; i++) {
      await expect(
        completeTwoFactorChallenge({ sessionId: next.session.id, user, method: "totp", code: "000000", meta, db: t.db }),
      ).rejects.toMatchObject({ code: "validation" });
    }
  });

  it("a pending session expires after 15 minutes: the challenge and the page send the visitor back to log in", async () => {
    expect(PENDING_TWO_FACTOR_TTL_MS).toBe(15 * 60_000);
    setFakeNow("2035-02-03T10:00:00Z");
    const { user, secretBase32 } = await enrolled();
    setFakeNow("2035-02-03T10:01:00Z");
    const { token } = await createSessionRecord(t.db, user.id, { twoFactorPending: true });
    jar.set(SESSION_COOKIE, token);

    setFakeNow("2035-02-03T10:15:30Z");
    expect((await requirePendingTwoFactorSession("/app/scheduling")).user.id).toBe(user.id);

    setFakeNow("2035-02-03T10:16:30Z");
    expect(await expectRedirect(requirePendingTwoFactorSession("/app/meetings"))).toBe("/login?error=expired&next=%2Fapp%2Fmeetings");
    const target = await expectRedirect(
      verifyTwoFactor(null, form({ method: "totp", code: totpCode(secretBase32, totpStep(nowMs())), next: "/app/meetings" })),
    );
    expect(target).toBe("/login?error=expired&next=%2Fapp%2Fmeetings");
    // The stale pending session is logged out; nothing was signed in.
    expect(await lookupSession(t.db, token)).toBeNull();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect((await t.db.select().from(sessions).where(eq(sessions.userId, user.id))).every((s) => s.revokedAt !== null)).toBe(true);
  });
});

describe("provider sign-in into an unverified account (AU-02, AU-11)", () => {
  const profile = (email: string, sub: string) => ({ providerAccountId: sub, email, emailVerified: true, name: "Vic Tim", avatarUrl: null });

  it("drops the password, 2FA and sessions that were set before the address was proven", async () => {
    const pre = await createUser(t.db, {
      email: "victim@example.com",
      passwordHash: await hashPassword("attacker-pw1"),
      overrides: { emailVerifiedAt: null, twoFactorEnabled: true, twoFactorSecretEnc: "v1.a.b.c" },
    });
    await t.db.insert(twoFactorRecoveryCodes).values({ userId: pre.id, codeHash: "f".repeat(64) });
    const squatter = await createSessionRecord(t.db, pre.id);

    const res = await resolveOAuthLogin({ provider: "google", profile: profile("Victim@example.com", "g-victim"), db: t.db });
    expect(res).toMatchObject({ created: false, linked: true, securedUnverifiedAccount: true });
    expect(res.user).toMatchObject({ id: pre.id, passwordHash: null, twoFactorEnabled: false, twoFactorSecretEnc: null });
    const [row] = await t.db.select().from(users).where(eq(users.id, pre.id));
    expect(row).toMatchObject({ passwordHash: null, twoFactorEnabled: false, twoFactorSecretEnc: null });
    expect(row?.emailVerifiedAt).not.toBeNull();
    expect(await lookupSession(t.db, squatter.token)).toBeNull();
    expect(await t.db.select().from(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, pre.id))).toHaveLength(0);
  });

  it("keeps the password and sessions of a verified account", async () => {
    const owner = await createUser(t.db, { email: "kept@example.com", passwordHash });
    const s = await createSessionRecord(t.db, owner.id);
    const res = await resolveOAuthLogin({ provider: "google", profile: profile("kept@example.com", "g-kept"), db: t.db });
    expect(res).toMatchObject({ created: false, linked: true, securedUnverifiedAccount: false });
    const [row] = await t.db.select().from(users).where(eq(users.id, owner.id));
    expect(row?.passwordHash).toBe(passwordHash);
    expect(await lookupSession(t.db, s.token)).not.toBeNull();
  });

  it("does the same when an invitation is accepted into an unverified account", async () => {
    const admin = await createUser(t.db, { email: "admin@acme.example" });
    const pre = await createUser(t.db, {
      email: "new.hire@acme.example",
      organizationId: admin.organizationId,
      passwordHash: await hashPassword("attacker-pw1"),
      overrides: { emailVerifiedAt: null },
    });
    const squatter = await createSessionRecord(t.db, pre.id);
    const { invitation, token } = await createInvitation(t.db, { organizationId: admin.organizationId, email: "new.hire@acme.example", invitedByUserId: admin.id });
    const res = await acceptInvitationWithOAuth({ provider: "google", profile: profile("new.hire@acme.example", "g-hire"), invitationToken: token, db: t.db });
    expect(res).toMatchObject({ created: false, linked: true, securedUnverifiedAccount: true });
    const [row] = await t.db.select().from(users).where(eq(users.id, pre.id));
    expect(row?.passwordHash).toBeNull();
    expect(await lookupSession(t.db, squatter.token)).toBeNull();
    const [inv] = await t.db.select().from(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
    expect(inv?.status).toBe("accepted");
    expect(await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, pre.id))).toHaveLength(1);
  });
});

describe("reset link binding (AU-07)", () => {
  it("stops working when the account's email changed after the link was sent", async () => {
    const u = await createUser(t.db, { email: "old.address@example.com", passwordHash: await hashPassword("old-password1"), overrides: { emailVerifiedAt: null } });
    await requestPasswordReset(u.email, { db: t.db, defer: false });
    const [mail] = await t.db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.relatedUserId, u.id), eq(emailOutbox.template, "auth.reset_password")));
    const token = /\/reset-password\/([A-Za-z0-9_-]+)/.exec(mail!.html)![1]!;
    expect(await peekPasswordResetToken(token)).toEqual({ email: "old.address@example.com" });

    await t.db.update(users).set({ email: "new.address@example.com", emailNormalized: "new.address@example.com" }).where(eq(users.id, u.id));
    expect(await peekPasswordResetToken(token)).toBeNull();
    await expect(resetPassword(token, "new-password1", { db: t.db })).rejects.toThrow(RESET_LINK_EXPIRED_MESSAGE);
    const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(await verifyPassword("old-password1", row!.passwordHash)).toBe(true);
    expect(row?.emailVerifiedAt).toBeNull();
  });
});

describe("login method code guesses (AU-10)", () => {
  it("counts parallel guesses atomically: a sixth guess is never checked", async () => {
    const u = await createUser(t.db);
    await sendLoginMethodCode(u.id, { db: t.db, defer: false });
    const [mail] = await t.db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.relatedUserId, u.id), eq(emailOutbox.template, "auth.login_method_code")));
    const code = /\b(\d{6})\b/.exec(mail!.text)![1]!;
    const wrong = code === "111111" ? "222222" : "111111";
    const results = await Promise.allSettled([...Array.from({ length: 7 }, () => wrong), code].map((c) => verifyLoginMethodCode(u.id, c, { db: t.db })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(0);
    const [row] = await t.db.select().from(verificationCodes).where(eq(verificationCodes.contextId, u.id));
    expect(row?.attempts).toBe(5);
    expect(row?.consumedAt).toBeNull();
  });
});
