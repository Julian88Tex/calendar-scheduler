// Regression tests from the adversarial review of foundation-auth (SPEC AU-02, AU-07, AU-09, AU-10, AU-11, AU-14,
// GEN-08):
// - login attempts are counted before the password check, so a burst of parallel guesses cannot exceed the window;
// - second factor guesses are limited per account across pending sessions, and a pending session expires;
// - signing in with a provider into an unverified account (pre-registered by someone else) drops the credentials
//   that were set before the address was proven, and every other way back in: other linked sign-in methods, calendar
//   connections, API tokens, calendar feeds, webhooks and pending invitations (pre-account hijacking);
// - a reset link only works for the address it was sent to;
// - parallel guesses of a login method code are counted atomically.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);
vi.mock("next/cache", async () => (await import("./_request")).nextCacheMock);

const {
  apiTokens,
  auditLog,
  calendarConnections,
  calendarFeeds,
  calendars,
  emailOutbox,
  oauthAccounts,
  organizationInvitations,
  organizationMemberships,
  rateLimitBuckets,
  sessions,
  twoFactorRecoveryCodes,
  users,
  verificationCodes,
  webhookSubscriptions,
} = await import("@/db/schema");
const { authenticateWithPassword } = await import("@/lib/auth/login");
const { verifyTwoFactor } = await import("@/app/(auth)/login/two-factor/actions");
const { requirePendingTwoFactorSession } = await import("@/lib/auth/guards");
const { PENDING_TWO_FACTOR_TTL_MS, beginTwoFactorEnrollment, completeTwoFactorChallenge, enableTwoFactor } = await import(
  "@/lib/auth/flows/two-factor"
);
const { acceptInvitationWithOAuth, linkOAuthLoginMethod, resolveOAuthLogin } = await import("@/lib/auth/flows/oauth-accounts");
const { signUpWithPassword } = await import("@/lib/auth/flows/signup-flow");
const { isInstanceAdminUser } = await import("@/lib/authz");
const { sendLoginMethodCode, verifyLoginMethodCode } = await import("@/lib/auth/flows/login-method-code");
const { peekPasswordResetToken, requestPasswordReset, resetPassword, RESET_LINK_EXPIRED_MESSAGE } = await import("@/lib/auth/password-reset");
const { SESSION_COOKIE, createSessionRecord, lookupSession } = await import("@/lib/auth/session");
const { totpCode, totpStep } = await import("@/lib/auth/totp");
const { hashPassword, verifyPassword } = await import("@/lib/crypto");
const { nowMs, resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const { createApiToken, createCalendarConnection, createCalendarFeed, createInvitation, createUser, createWebhookSubscription } = await import(
  "../factories"
);
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

  it("keeps the password, sessions, sign-in methods and grants of a verified account", async () => {
    const owner = await createUser(t.db, { email: "kept@example.com", passwordHash });
    const s = await createSessionRecord(t.db, owner.id);
    await linkOAuthLoginMethod({ userId: owner.id, provider: "microsoft", profile: profile("kept@example.com", "ms-kept"), db: t.db });
    await createCalendarConnection(t.db, { userId: owner.id });
    await createApiToken(t.db, { userId: owner.id });
    const res = await resolveOAuthLogin({ provider: "google", profile: profile("kept@example.com", "g-kept"), db: t.db });
    expect(res).toMatchObject({ created: false, linked: true, securedUnverifiedAccount: false });
    const [row] = await t.db.select().from(users).where(eq(users.id, owner.id));
    expect(row?.passwordHash).toBe(passwordHash);
    expect(await lookupSession(t.db, s.token)).not.toBeNull();
    expect(await t.db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, owner.id))).toHaveLength(2);
    expect(await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, owner.id))).toHaveLength(1);
    expect(await t.db.select().from(apiTokens).where(eq(apiTokens.userId, owner.id))).toHaveLength(1);
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
    await linkOAuthLoginMethod({ userId: pre.id, provider: "google", profile: profile("squatter@evil.example", "g-hire-squatter"), db: t.db });
    const { invitation, token } = await createInvitation(t.db, { organizationId: admin.organizationId, email: "new.hire@acme.example", invitedByUserId: admin.id });
    const res = await acceptInvitationWithOAuth({ provider: "google", profile: profile("new.hire@acme.example", "g-hire"), invitationToken: token, db: t.db });
    expect(res).toMatchObject({ created: false, linked: true, securedUnverifiedAccount: true });
    const [row] = await t.db.select().from(users).where(eq(users.id, pre.id));
    expect(row?.passwordHash).toBeNull();
    expect(await lookupSession(t.db, squatter.token)).toBeNull();
    const logins = await t.db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, pre.id));
    expect(logins.map((l) => l.providerAccountId)).toEqual(["g-hire"]);
    const [inv] = await t.db.select().from(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
    expect(inv?.status).toBe("accepted");
    expect(await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, pre.id))).toHaveLength(1);
  });
});

describe("a squatted ADMIN_EMAILS address (AU-02, AU-10, AU-11)", () => {
  const profile = (email: string, sub: string) => ({ providerAccountId: sub, email, emailVerified: true, name: "Ops", avatarUrl: null });

  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAILS", "ops@example.com");
    vi.stubEnv("SIGNUP_POLICY", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("the admin proving the address with Google locks out the squatter's own Google account, calendar, tokens and invitations", async () => {
    await createUser(t.db, { email: "first.account@example.com" }); // so the squatter is not the instance's first account
    const { user: pre } = await signUpWithPassword({
      email: "ops@example.com",
      name: "Not Ops",
      password: "attacker-pw1",
      meta: { ip: "203.0.113.9", userAgent: null },
      db: t.db,
    });
    expect(isInstanceAdminUser(pre)).toBe(false); // the ADMIN_EMAILS grant waits for a verified email
    const [membership] = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, pre.id));
    const organizationId = membership!.organizationId;

    // The squatter links their own Google account (link_login_method only needs a session), which also connects its
    // calendar, then hands out more access.
    const squatterGoogle = profile("squatter@evil.example", "g-squatter");
    const link = await linkOAuthLoginMethod({ userId: pre.id, provider: "google", profile: squatterGoogle, db: t.db });
    expect(link.linked).toBe(true);
    const { connection, calendars: cals } = await createCalendarConnection(t.db, {
      userId: pre.id,
      accountEmail: "squatter@evil.example",
      overrides: { providerAccountId: "g-squatter", oauthAccountId: link.oauthAccountId },
    });
    await t.db.update(users).set({ destinationCalendarId: cals[0]!.id }).where(eq(users.id, pre.id));
    await createApiToken(t.db, { userId: pre.id });
    await createCalendarFeed(t.db, { userId: pre.id });
    const hook = await createWebhookSubscription(t.db, { owner: { ...pre, organizationId, orgRole: "owner" } });
    const { invitation } = await createInvitation(t.db, { organizationId, email: "accomplice@evil.example", invitedByUserId: pre.id });

    // The real admin signs in with Google.
    const opsGoogle = profile("Ops@Example.com", "g-ops");
    const res = await resolveOAuthLogin({ provider: "google", profile: opsGoogle, db: t.db });
    expect(res).toMatchObject({ created: false, linked: true, securedUnverifiedAccount: true });
    expect(res.user).toMatchObject({ id: pre.id, passwordHash: null, destinationCalendarId: null });
    expect(isInstanceAdminUser(res.user)).toBe(true);

    // Only the admin's Google account signs in to the account now.
    const logins = await t.db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, pre.id));
    expect(logins.map((l) => l.id)).toEqual([res.oauthAccountId]);
    await expect(resolveOAuthLogin({ provider: "google", profile: squatterGoogle, db: t.db })).rejects.toMatchObject({ code: "signups_closed" });
    expect(await resolveOAuthLogin({ provider: "google", profile: opsGoogle, db: t.db })).toMatchObject({ user: { id: pre.id }, linked: false });

    // Nothing else the squatter set up survives.
    expect(await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, pre.id))).toHaveLength(0);
    expect(await t.db.select().from(calendars).where(eq(calendars.userId, pre.id))).toHaveLength(0);
    expect(await t.db.select().from(apiTokens).where(eq(apiTokens.userId, pre.id))).toHaveLength(0);
    expect(await t.db.select().from(calendarFeeds).where(eq(calendarFeeds.userId, pre.id))).toHaveLength(0);
    expect(await t.db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, hook.id))).toHaveLength(0);
    const [inv] = await t.db.select().from(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
    expect(inv?.status).toBe("revoked");

    // Removals with a catalog action are audited.
    const unlinked = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "login_method.disconnected"), eq(auditLog.targetId, pre.id)));
    expect(unlinked.map((e) => e.details)).toEqual([{ provider: "google", email: "squatter@evil.example", via: "unverified_account_claimed" }]);
    const [calendarEntry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "calendar.disconnected"), eq(auditLog.targetId, connection.id)));
    expect(calendarEntry).toMatchObject({
      namespace: "calendars",
      actorUserId: pre.id,
      organizationId,
      details: { provider: "google", email: "squatter@evil.example", via: "unverified_account_claimed" },
    });
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
