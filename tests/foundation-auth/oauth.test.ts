// Google and Microsoft OAuth (SPEC AU-02, AU-03, AU-09, AU-10, AU-11, AU-13, CAL-17, TM-03; ARCHITECTURE 10.4, 18.4):
// the start and callback flow against mocked provider endpoints for every intent. Other modules' contracts
// (calendars.linkCalendarFromOAuth, calendars.handleConnectCallback, polls.handleVoterFreeBusyCallback, the teams
// invitation functions) are mocked.
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthCallbackContext } from "@/lib/auth/oauth/types";

const calls = vi.hoisted(() => ({
  linkCalendar: [] as unknown[],
  connect: [] as OAuthCallbackContext[],
  poll: [] as OAuthCallbackContext[],
}));

vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);
vi.mock("next/cache", async () => (await import("./_request")).nextCacheMock);
vi.mock("@/lib/calendars", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/calendars")>()),
  linkCalendarFromOAuth: async (p: unknown) => {
    calls.linkCalendar.push(p);
  },
}));
vi.mock("@/lib/calendars/oauth-connect", () => ({
  handleConnectCallback: async (ctx: OAuthCallbackContext) => {
    calls.connect.push(ctx);
    return new Response(null, { status: 303, headers: { Location: "http://localhost:3000/app/availability/calendar-settings?connected=1" } });
  },
}));
vi.mock("@/lib/polls/voter-oauth", () => ({
  handleVoterFreeBusyCallback: async (ctx: OAuthCallbackContext) => {
    calls.poll.push(ctx);
    return new Response("ok", { status: 200 });
  },
}));
// teams-org contract: a test double with the documented behavior (pending, unexpired invitation by token hash;
// membership with the invited role and the invitation marked accepted).
vi.mock("@/lib/teams", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/teams")>();
  const { and: andOp, eq: eqOp } = await import("drizzle-orm");
  const { getDb } = await import("@/db");
  const schema = await import("@/db/schema");
  const { hashToken } = await import("@/lib/crypto");
  const { AppError } = await import("@/lib/errors");
  return {
    ...orig,
    getPendingInvitation: async (token: string) => {
      const db = await getDb();
      const [row] = await db
        .select()
        .from(schema.organizationInvitations)
        .where(andOp(eqOp(schema.organizationInvitations.tokenHash, hashToken(token)), eqOp(schema.organizationInvitations.status, "pending")))
        .limit(1);
      if (!row || row.expiresAt.getTime() < Date.now()) return null;
      return {
        id: row.id,
        organizationId: row.organizationId,
        organizationName: "Acme",
        email: row.email,
        emailNormalized: row.emailNormalized,
        role: row.role === "admin" ? "admin" : "user",
        teamIds: row.teamIds,
        invitedByName: null,
        expiresAt: row.expiresAt,
      };
    },
    acceptInvitationInTx: async (tx: import("@/db").DbOrTx, p: { invitationId: string; userId: string }) => {
      const [inv] = await tx.select().from(schema.organizationInvitations).where(eqOp(schema.organizationInvitations.id, p.invitationId));
      if (!inv || inv.status !== "pending") throw new AppError("not_found", "This invitation is no longer valid.");
      const [m] = await tx.select().from(schema.organizationMemberships).where(eqOp(schema.organizationMemberships.userId, p.userId));
      if (m && m.organizationId !== inv.organizationId) throw new AppError("conflict", "You already belong to another workspace.");
      if (!m) await tx.insert(schema.organizationMemberships).values({ organizationId: inv.organizationId, userId: p.userId, role: inv.role });
      await tx
        .update(schema.organizationInvitations)
        .set({ status: "accepted", acceptedUserId: p.userId })
        .where(eqOp(schema.organizationInvitations.id, inv.id));
    },
  };
});

const schema = await import("@/db/schema");
const { auditLog, emailOutbox, eventTypes, instanceSettings, oauthAccounts, organizationInvitations, organizationMemberships, organizations, sessions, users } = schema;
const { handleOAuthCallback, handleOAuthStart } = await import("@/lib/auth/oauth/flow");
const { OAUTH_STATE_COOKIE } = await import("@/lib/auth/oauth/state");
const { oauthErrorMessage } = await import("@/lib/auth/oauth/errors");
const { oauthStartPath } = await import("@/lib/auth/oauth/links");
const { googleProfileFromIdToken } = await import("@/lib/auth/oauth/google");
const { microsoftProfileFromIdToken, MICROSOFT_CONSUMER_TENANT_ID } = await import("@/lib/auth/oauth/microsoft");
const { SESSION_COOKIE, createSessionRecord, lookupSession } = await import("@/lib/auth/session");
const { hashPassword } = await import("@/lib/crypto");
const { createLoginMethodConfirmation } = await import("@/lib/auth/flows/login-method-code");
const { useTestDb } = await import("../helpers/db");
const { createCalendarConnection, createInvitation, createUser } = await import("../factories");
const { fakeIdToken, googleRoutes, microsoftRoutes, mockFetch } = await import("../helpers/fake-providers");
const { jar, locationOf, resetRequest } = await import("./_request");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const OAUTH_ENV = {
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  MICROSOFT_CLIENT_ID: "ms-client",
  MICROSOFT_CLIENT_SECRET: "ms-secret",
};

beforeAll(() => Object.assign(env, OAUTH_ENV));
afterAll(() => {
  for (const k of Object.keys(OAUTH_ENV)) delete env[k];
  delete env.SIGNUP_POLICY;
  delete env.OWNER_EMAIL;
});
beforeEach(async () => {
  resetRequest();
  calls.linkCalendar.length = 0;
  calls.connect.length = 0;
  calls.poll.length = 0;
  delete env.SIGNUP_POLICY;
  delete env.OWNER_EMAIL;
  await t.db.delete(users);
  await t.db.delete(organizations);
  await t.db.delete(instanceSettings);
  await t.db.delete(emailOutbox);
});

type Provider = "google" | "microsoft";

const googleClaims = (over: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  sub: "google-sub-1",
  email: "Gina@Gmail.example",
  email_verified: true,
  name: "Gina Gee",
  picture: "https://lh3.googleusercontent.example/a/photo",
  ...over,
});

const msClaims = (over: Record<string, unknown> = {}) => ({
  iss: "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0",
  oid: "ms-oid-1",
  sub: "ms-sub-1",
  tid: "11111111-2222-3333-4444-555555555555",
  preferred_username: "max@contoso.example",
  email: "max@contoso.example",
  name: "Max Muster",
  ...over,
});

/** Runs start then callback with the provider's token endpoint mocked; returns both responses. */
async function flow(
  provider: Provider,
  query: string,
  claims: Record<string, unknown>,
  token: { refreshToken?: string | null; scope?: string; accessToken?: string } = {},
) {
  const start = await handleOAuthStart(new Request(`http://localhost:3000/api/auth/${provider}/start${query ? `?${query}` : ""}`), provider);
  if (start.status !== 302) return { start, authorize: null, callback: null, fetch: null };
  const authorize = new URL(start.headers.get("location")!);
  const state = authorize.searchParams.get("state")!;
  const idToken = fakeIdToken(claims);
  const fm = mockFetch(...(provider === "google" ? googleRoutes({}, { idToken, ...token }) : microsoftRoutes({}, { idToken, ...token })));
  try {
    const callback = await handleOAuthCallback(
      new Request(`http://localhost:3000/api/auth/${provider}/callback?code=auth-code-1&state=${encodeURIComponent(state)}`),
      provider,
    );
    return { start, authorize, callback, fetch: fm };
  } finally {
    fm.restore();
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("start route", () => {
  it("redirects a signup to Google with PKCE S256, the AU-02 scopes and parameters, and a sealed 10 minute state cookie", async () => {
    const res = await handleOAuthStart(new Request("http://localhost:3000/api/auth/google/start?intent=signup&next=/app/meetings&tz=America/Chicago"), "google");
    expect(res.status).toBe(302);
    const u = new URL(res.headers.get("location")!);
    expect(`${u.origin}${u.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = u.searchParams;
    expect(q.get("client_id")).toBe("google-client");
    expect(q.get("redirect_uri")).toBe("http://localhost:3000/api/auth/google/callback");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("scope")).toBe(
      "openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.send",
    );
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("include_granted_scopes")).toBe("true");
    const sealed = jar.get(OAUTH_STATE_COOKIE)!;
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain(q.get("state")!);
  });

  it("a Google login asks only for openid, email and profile with select_account and no offline access", async () => {
    const res = await handleOAuthStart(new Request("http://localhost:3000/api/auth/google/start?next=/app/meetings"), "google");
    expect(res.status).toBe(302);
    const q = new URL(res.headers.get("location")!).searchParams;
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("prompt")).toBe("select_account");
    expect(q.get("access_type")).toBeNull();
    expect(q.get("include_granted_scopes")).toBeNull();
    expect(q.get("code_challenge_method")).toBe("S256");
  });

  it("redirects to Microsoft (tenant common) with the AU-03 scopes", async () => {
    const res = await handleOAuthStart(new Request("http://localhost:3000/api/auth/microsoft/start"), "microsoft");
    const u = new URL(res.headers.get("location")!);
    expect(`${u.origin}${u.pathname}`).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(u.searchParams.get("scope")).toBe("openid profile email offline_access User.Read Calendars.ReadWrite OnlineMeetings.ReadWrite");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/microsoft/callback");
  });

  it("goes back with not_configured when the provider has no credentials", async () => {
    delete env.GOOGLE_CLIENT_SECRET;
    try {
      const res = await handleOAuthStart(new Request("http://localhost:3000/api/auth/google/start"), "google");
      expect(res.status).toBe(303);
      expect(locationOf(res)).toBe("/login?error=not_configured&provider=google");
    } finally {
      env.GOOGLE_CLIENT_SECRET = OAUTH_ENV.GOOGLE_CLIENT_SECRET;
    }
  });

  it("builds start links for other modules", () => {
    expect(oauthStartPath("google", { intent: "accept_invitation", invitation: "tok" })).toBe("/api/auth/google/start?intent=accept_invitation&invitation=tok");
    expect(oauthStartPath("microsoft", { next: "/app/x", data: { poll: "abc", intent: "ignored" } })).toBe("/api/auth/microsoft/start?next=%2Fapp%2Fx&poll=abc");
  });
});

describe("login and signup intents (AU-02, CAL-17)", () => {
  it("creates exactly one user, one oauth account, one calendar link and one session; repeating logs in without duplicates", async () => {
    const first = await flow("google", "intent=signup&tz=America/Chicago", googleClaims());
    expect(first.callback!.status).toBe(303);
    expect(locationOf(first.callback!)).toBe("/app/scheduling");

    // PKCE: the verifier sent to the token endpoint matches the challenge of the authorize URL.
    const tokenCall = first.fetch!.callsTo("oauth2.googleapis.com/token", "POST")[0]!;
    const body = tokenCall.body as Record<string, string>;
    expect(body.grant_type).toBe("authorization_code");
    expect(body.code).toBe("auth-code-1");
    expect(createHash("sha256").update(body.code_verifier!).digest("base64url")).toBe(first.authorize!.searchParams.get("code_challenge"));

    const allUsers = await t.db.select().from(users);
    expect(allUsers).toHaveLength(1);
    const u = allUsers[0]!;
    expect(u).toMatchObject({ email: "Gina@Gmail.example", name: "Gina Gee", avatarUrl: "https://lh3.googleusercontent.example/a/photo", timezone: "America/Chicago", isInstanceAdmin: true });
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(u.passwordHash).toBeNull();
    const accounts = await t.db.select().from(oauthAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ userId: u.id, provider: "google", providerAccountId: "google-sub-1", emailNormalized: "gina@gmail.example" });
    expect(calls.linkCalendar).toHaveLength(1);
    expect(calls.linkCalendar[0]).toMatchObject({
      userId: u.id,
      provider: "google",
      providerAccountId: "google-sub-1",
      accountEmail: "Gina@Gmail.example",
      oauthAccountId: accounts[0]!.id,
      tokens: { accessToken: expect.any(String), refreshToken: expect.any(String), expiresAt: expect.any(Date), scopes: expect.any(Array) },
    });
    const liveSessions = (await t.db.select().from(sessions)).filter((s) => !s.revokedAt);
    expect(liveSessions).toHaveLength(1);
    expect(jar.has(OAUTH_STATE_COOKIE)).toBe(false);
    // AU-13: Google signups get Google Meet on the default event type.
    const [et] = await t.db.select().from(eventTypes).where(eq(eventTypes.ownerUserId, u.id));
    expect(et?.locations.map((l) => l.kind)).toEqual(["google_conference"]);
    // Welcome email, no verification email (Google verified the address).
    const mail = await t.db.select().from(emailOutbox).where(eq(emailOutbox.relatedUserId, u.id));
    expect(mail.map((m) => m.template)).toEqual(["auth.welcome"]);
    const signupAudit = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.signup"), eq(auditLog.targetId, u.id)));
    expect(signupAudit[0]?.details).toMatchObject({ method: "google" });

    // Again: logs in (no duplicate user or account), the previous session revoked. A login is a basic sign-in (openid,
    // email, profile): it never touches the calendar connection.
    const second = await flow("google", "next=/app/meetings", googleClaims({ email: "gina@gmail.example" }), { refreshToken: null });
    expect(locationOf(second.callback!)).toBe("/app/meetings");
    expect(await t.db.select().from(users)).toHaveLength(1);
    expect(await t.db.select().from(oauthAccounts)).toHaveLength(1);
    expect(calls.linkCalendar).toHaveLength(1);
    expect((await t.db.select().from(sessions)).filter((s) => !s.revokedAt)).toHaveLength(1);
    const logins = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.login"), eq(auditLog.targetId, u.id)));
    expect(logins.map((l) => (l.details as { method: string }).method)).toEqual(["google", "google"]);

    // A signup of the same account logs in too and refreshes the calendar link (keeping the stored refresh token).
    const third = await flow("google", "intent=signup", googleClaims(), { refreshToken: null });
    expect(locationOf(third.callback!)).toBe("/app/scheduling");
    expect(await t.db.select().from(users)).toHaveLength(1);
    expect(calls.linkCalendar).toHaveLength(2);
    expect(calls.linkCalendar[1]).toMatchObject({ userId: u.id, providerAccountId: "google-sub-1", tokens: { refreshToken: null } });
  });

  it("links a password account with the same verified email instead of creating one", async () => {
    const pw = await hashPassword("pw-123456");
    const existing = await createUser(t.db, { email: "gina@gmail.example", passwordHash: pw });
    const res = await flow("google", "", googleClaims());
    expect(locationOf(res.callback!)).toBe("/app/scheduling");
    expect(await t.db.select().from(users)).toHaveLength(1);
    const [acct] = await t.db.select().from(oauthAccounts);
    expect(acct?.userId).toBe(existing.id);
    const [u] = await t.db.select().from(users);
    expect(u?.passwordHash).toBe(pw);
    const linked = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "login_method.connected"), eq(auditLog.targetId, existing.id)));
    expect(linked).toHaveLength(1);
    expect((await lookupSession(t.db, jar.get(SESSION_COOKIE)))?.user.id).toBe(existing.id);
  });

  it("claims an unverified account: the password and sessions set before the address was proven stop working", async () => {
    const squatter = await createUser(t.db, { email: "gina@gmail.example", passwordHash: await hashPassword("pw-123456"), overrides: { emailVerifiedAt: null } });
    const squatterSession = await createSessionRecord(t.db, squatter.id);
    const res = await flow("google", "", googleClaims());
    expect(locationOf(res.callback!)).toBe("/app/scheduling");
    const [u] = await t.db.select().from(users);
    expect(u).toMatchObject({ id: squatter.id, passwordHash: null });
    expect(u?.emailVerifiedAt).not.toBeNull();
    expect(await lookupSession(t.db, squatterSession.token)).toBeNull();
    expect((await lookupSession(t.db, jar.get(SESSION_COOKIE)))?.user.id).toBe(squatter.id);
    const [connected] = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "login_method.connected"), eq(auditLog.targetId, squatter.id)));
    expect(connected?.details).toMatchObject({ provider: "google", auto: true, securedUnverifiedAccount: true });
    const pwAudit = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.password_changed"), eq(auditLog.targetId, squatter.id)));
    expect(pwAudit[0]?.details).toMatchObject({ via: "unverified_account_claimed" });
  });

  it("returns to login with 'Google sign in was canceled.' when consent is denied", async () => {
    const start = await handleOAuthStart(new Request("http://localhost:3000/api/auth/google/start"), "google");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const res = await handleOAuthCallback(new Request(`http://localhost:3000/api/auth/google/callback?error=access_denied&state=${state}`), "google");
    expect(locationOf(res)).toBe("/login?error=canceled&provider=google");
    expect(oauthErrorMessage("canceled", { provider: "google" })).toBe("Google sign in was canceled.");
    expect(await t.db.select().from(users)).toHaveLength(0);
  });

  it("rejects an unverified Google email", async () => {
    const res = await flow("google", "", googleClaims({ email_verified: false }));
    expect(locationOf(res.callback!)).toBe("/login?error=email_unverified&provider=google");
    expect(oauthErrorMessage("email_unverified", { provider: "google" })).toBe("Your Google email isn't verified.");
    expect(await t.db.select().from(users)).toHaveLength(0);
  });

  it("follows the signup policy for unknown emails (invite_only)", async () => {
    await createUser(t.db, { email: "owner@example.com" });
    const res = await flow("google", "intent=signup", googleClaims());
    expect(locationOf(res.callback!)).toBe("/signup?error=signups_closed&provider=google");
    const login = await flow("google", "", googleClaims({ sub: "google-sub-2" }));
    expect(locationOf(login.callback!)).toBe("/login?error=signups_closed&provider=google");
    expect(oauthErrorMessage("signups_closed")).toBe("Sign ups are closed. Ask an admin for an invitation.");
    expect(await t.db.select().from(users)).toHaveLength(1);
    expect(calls.linkCalendar).toHaveLength(0);
  });

  it("with OWNER_EMAIL set, only the owner's Google signup claims a fresh instance (and becomes instance admin)", async () => {
    env.OWNER_EMAIL = " gina@gmail.EXAMPLE ";
    const stranger = await flow("google", "intent=signup", googleClaims({ sub: "google-sub-9", email: "eve@evil.example", name: "Eve" }));
    expect(locationOf(stranger.callback!)).toBe("/signup?error=signups_closed&provider=google");
    expect(await t.db.select().from(users)).toHaveLength(0);
    const owner = await flow("google", "intent=signup", googleClaims());
    expect(locationOf(owner.callback!)).toBe("/app/scheduling");
    const all = await t.db.select().from(users);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ email: "Gina@Gmail.example", isInstanceAdmin: true });
  });

  it("rejects a callback whose state does not match the cookie, or without a cookie", async () => {
    await handleOAuthStart(new Request("http://localhost:3000/api/auth/google/start"), "google");
    const res = await handleOAuthCallback(new Request("http://localhost:3000/api/auth/google/callback?code=x&state=forged"), "google");
    expect(locationOf(res)).toBe("/login?error=expired&provider=google");
    const none = await handleOAuthCallback(new Request("http://localhost:3000/api/auth/google/callback?code=x&state=forged"), "google");
    expect(locationOf(none)).toBe("/login?error=expired&provider=google");
  });

  it("sends 2FA users to /login/two-factor with a pending session (AU-09)", async () => {
    const u = await createUser(t.db, { email: "gina@gmail.example", overrides: { twoFactorEnabled: true, twoFactorSecretEnc: "v1.x.y.z" } });
    const res = await flow("google", "next=/app/workflows", googleClaims());
    expect(locationOf(res.callback!)).toBe("/login/two-factor?next=%2Fapp%2Fworkflows&method=google");
    const s = await lookupSession(t.db, jar.get(SESSION_COOKIE));
    expect(s?.user.id).toBe(u.id);
    expect(s?.session.twoFactorPending).toBe(true);
  });
});

describe("Microsoft (AU-03)", () => {
  it("signs up a work account (no default location: Teams is out of scope) with the newest refresh token; the templated issuer is accepted", async () => {
    const res = await flow("microsoft", "intent=signup", msClaims(), { refreshToken: "rt-rotated-1" });
    expect(locationOf(res.callback!)).toBe("/app/scheduling");
    const [u] = await t.db.select().from(users);
    expect(u?.email).toBe("max@contoso.example");
    const [et] = await t.db.select().from(eventTypes).where(eq(eventTypes.ownerUserId, u!.id));
    expect(et?.locations).toEqual([]);
    expect(calls.linkCalendar[0]).toMatchObject({ provider: "microsoft", providerAccountId: "ms-oid-1", tokens: { refreshToken: "rt-rotated-1" } });
  });

  it("personal accounts get no default location", async () => {
    await flow("microsoft", "intent=signup", msClaims({ tid: MICROSOFT_CONSUMER_TENANT_ID, email: "pat@outlook.example", preferred_username: "pat@outlook.example" }));
    const [u] = await t.db.select().from(users);
    const [et] = await t.db.select().from(eventTypes).where(eq(eventTypes.ownerUserId, u!.id));
    expect(et?.locations).toEqual([]);
  });

  it("with OWNER_EMAIL set, a work tenant naming the owner's address in its unverified email claim cannot claim the instance", async () => {
    env.OWNER_EMAIL = "owner@victim.example";
    // nOAuth: any tenant admin can set a user's email attribute; without xms_edov only the UPN (a domain the tenant
    // verified) counts, and it is not the owner's.
    const forged = await flow("microsoft", "intent=signup", msClaims({ email: "owner@victim.example", preferred_username: "max@contoso.example" }));
    expect(locationOf(forged.callback!)).toBe("/signup?error=signups_closed&provider=microsoft");
    const noUpn = await flow("microsoft", "intent=signup", msClaims({ oid: "ms-oid-2", email: "owner@victim.example", preferred_username: undefined }));
    expect(locationOf(noUpn.callback!)).toBe("/signup?error=email_unverified&provider=microsoft");
    expect(await t.db.select().from(users)).toHaveLength(0);
    const owner = await flow("microsoft", "intent=signup", msClaims({ oid: "ms-oid-3", email: "owner@victim.example", xms_edov: true }));
    expect(locationOf(owner.callback!)).toBe("/app/scheduling");
    expect(await t.db.select({ email: users.emailNormalized, isInstanceAdmin: users.isInstanceAdmin }).from(users)).toEqual([
      { email: "owner@victim.example", isInstanceAdmin: true },
    ]);
  });

  it("trusts the email claim only for personal accounts or with xms_edov; otherwise the user principal name", () => {
    const tok = (c: Record<string, unknown>) => fakeIdToken(msClaims(c));
    expect(microsoftProfileFromIdToken(tok({ tid: MICROSOFT_CONSUMER_TENANT_ID }))).toMatchObject({ emailVerified: true, isWorkAccount: false });
    // Work account whose email claim differs from the UPN: the UPN is used.
    expect(microsoftProfileFromIdToken(tok({ email: "ceo@victim.example", preferred_username: "max@contoso.example" }))).toMatchObject({
      email: "max@contoso.example",
      emailVerified: true,
      isWorkAccount: true,
    });
    expect(microsoftProfileFromIdToken(tok({ email: "max@contoso.example", xms_edov: true, preferred_username: "max_contoso#ext@x" }))).toMatchObject({
      email: "max@contoso.example",
      emailVerified: true,
    });
    expect(microsoftProfileFromIdToken(tok({ email: "max@contoso.example", preferred_username: undefined, upn: undefined }))).toMatchObject({
      emailVerified: false,
    });
    expect(() => microsoftProfileFromIdToken(tok({ email: undefined, preferred_username: undefined }))).toThrow(/did not share an email/);
  });

  it("Google profiles come from the id token claims", () => {
    expect(googleProfileFromIdToken(fakeIdToken(googleClaims({ hd: "acme.example" })))).toMatchObject({
      providerAccountId: "google-sub-1",
      email: "Gina@Gmail.example",
      emailVerified: true,
      name: "Gina Gee",
      isWorkAccount: true,
    });
  });
});

describe("accept_invitation (AU-11, TM-03)", () => {
  async function setupInvite(email: string) {
    const owner = await createUser(t.db, { email: "owner@acme.example" });
    const { invitation, token } = await createInvitation(t.db, { organizationId: owner.organizationId, email, role: "user", invitedByUserId: owner.id });
    return { owner, invitation, token };
  }

  it("creates the account inside the inviting organization under invite_only", async () => {
    const { owner, invitation, token } = await setupInvite("max@contoso.example");
    const start = await handleOAuthStart(new Request(`http://localhost:3000/api/auth/microsoft/start?intent=accept_invitation&invitation=${token}`), "microsoft");
    expect(new URL(start.headers.get("location")!).searchParams.get("login_hint")).toBe("max@contoso.example");
    const res = await flow("microsoft", `intent=accept_invitation&invitation=${token}`, msClaims());
    expect(locationOf(res.callback!)).toBe("/app/scheduling");
    const [u] = await t.db.select().from(users).where(eq(users.emailNormalized, "max@contoso.example"));
    expect(u?.createdViaInvitationId).toBe(invitation.id);
    expect(u?.isInstanceAdmin).toBe(false);
    const [m] = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, u!.id));
    expect(m).toMatchObject({ organizationId: owner.organizationId, role: "user" });
    const [inv] = await t.db.select().from(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
    expect(inv).toMatchObject({ status: "accepted", acceptedUserId: u!.id });
    expect(await t.db.select().from(organizations)).toHaveLength(1);
    // Identity only: accepting an invitation never connects a calendar.
    expect(calls.linkCalendar).toHaveLength(0);
  });

  it("asks Google only for openid, email and profile, with the invited email as the login_hint", async () => {
    const { token } = await setupInvite("gina@gmail.example");
    const start = await handleOAuthStart(new Request(`http://localhost:3000/api/auth/google/start?intent=accept_invitation&invitation=${token}`), "google");
    const q = new URL(start.headers.get("location")!).searchParams;
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("prompt")).toBe("select_account");
    expect(q.get("access_type")).toBeNull();
    expect(q.get("login_hint")).toBe("gina@gmail.example");
  });

  it("rejects a provider email that differs from the invitation with the documented message", async () => {
    const { token, invitation } = await setupInvite("bob@acme.example");
    const res = await flow("microsoft", `intent=accept_invitation&invitation=${token}`, msClaims());
    expect(locationOf(res.callback!)).toBe(`/invite/${token}?error=invitation_email_mismatch&provider=microsoft`);
    expect(oauthErrorMessage("invitation_email_mismatch", { invitedEmail: "bob@acme.example" })).toBe("Use bob@acme.example to accept this invitation.");
    const [inv] = await t.db.select().from(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
    expect(inv?.status).toBe("pending");
    expect(await t.db.select().from(users)).toHaveLength(1);
  });

  it("an unknown or used invitation token is refused at start", async () => {
    const res = await handleOAuthStart(new Request("http://localhost:3000/api/auth/google/start?intent=accept_invitation&invitation=nope"), "google");
    expect(locationOf(res)).toBe("/invite/nope?error=invitation_invalid&provider=google");
  });
});

describe("connect_calendar, link_login_method and poll_freebusy", () => {
  async function signIn(email = "carla@example.com") {
    const u = await createUser(t.db, { email, passwordHash: await hashPassword("pw-123456") });
    const { token } = await createSessionRecord(t.db, u.id);
    jar.set(SESSION_COOKIE, token);
    return u;
  }

  it("connect_calendar needs a signed-in user and hands the callback to calendars.handleConnectCallback", async () => {
    const anon = await handleOAuthStart(new Request("http://localhost:3000/api/auth/google/start?intent=connect_calendar"), "google");
    expect(locationOf(anon)).toBe(`/login?next=${encodeURIComponent("/api/auth/google/start?intent=connect_calendar")}`);
    const u = await signIn();
    const res = await flow("google", "intent=connect_calendar&next=/app/availability/calendar-settings", googleClaims({ email: "other@gmail.example", sub: "g-cal" }));
    expect(locationOf(res.callback!)).toBe("/app/availability/calendar-settings?connected=1");
    expect(calls.connect).toHaveLength(1);
    expect(calls.connect[0]).toMatchObject({ intent: "connect_calendar", userId: u.id, provider: "google", profile: { email: "other@gmail.example" } });
    expect(await t.db.select().from(oauthAccounts)).toHaveLength(0);
  });

  it("connect_calendar (first connect and every Reconnect) asks for every scope with consent and offline access", async () => {
    const u = await signIn();
    const { connection } = await createCalendarConnection(t.db, { userId: u.id, accountEmail: "carla.work@gmail.example" });
    for (const query of ["", `&reconnect=${connection.id}`]) {
      const res = await handleOAuthStart(new Request(`http://localhost:3000/api/auth/google/start?intent=connect_calendar${query}`), "google");
      const q = new URL(res.headers.get("location")!).searchParams;
      expect(q.get("scope")).toBe(
        "openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.send",
      );
      expect(q.get("prompt")).toBe("consent");
      expect(q.get("access_type")).toBe("offline");
      expect(q.get("include_granted_scopes")).toBe("true");
    }
  });

  it("connect_calendar with data.reconnect uses that connection's account email as the login_hint (own connections only)", async () => {
    const u = await signIn();
    const { connection } = await createCalendarConnection(t.db, { userId: u.id, accountEmail: "carla.work@gmail.example" });
    const other = await createUser(t.db, { email: "otto@example.com" });
    const { connection: foreign } = await createCalendarConnection(t.db, { userId: other.id, accountEmail: "otto@gmail.example" });
    const hint = async (query: string) => {
      const res = await handleOAuthStart(new Request(`http://localhost:3000/api/auth/google/start?intent=connect_calendar${query}`), "google");
      expect(res.status).toBe(302);
      return new URL(res.headers.get("location")!).searchParams.get("login_hint");
    };
    expect(await hint(`&reconnect=${connection.id}`)).toBe("carla.work@gmail.example");
    expect(await hint(`&reconnect=${foreign.id}`)).toBeNull();
    expect(await hint("&reconnect=not-a-uuid")).toBeNull();
    expect(await hint("")).toBeNull();
  });

  it("link_login_method requires the AU-10 confirmation of the emailed code", async () => {
    const u = await signIn();
    const res = await handleOAuthStart(new Request("http://localhost:3000/api/auth/google/start?intent=link_login_method"), "google");
    expect(locationOf(res)).toBe("/app/settings/login?oauth_error=confirmation_required&provider=google");
    const forged = await handleOAuthStart(new Request(`http://localhost:3000/api/auth/google/start?intent=link_login_method&confirm=${Date.now() + 60_000}.deadbeef`), "google");
    expect(locationOf(forged)).toContain("oauth_error=confirmation_required");
    const otherUsers = await createLoginMethodConfirmation("00000000-0000-4000-8000-000000000000");
    const wrongUser = await handleOAuthStart(new Request(`http://localhost:3000/api/auth/google/start?intent=link_login_method&confirm=${otherUsers}`), "google");
    expect(locationOf(wrongUser)).toContain("oauth_error=confirmation_required");
    const ok = await handleOAuthStart(new Request(`http://localhost:3000/api/auth/google/start?intent=link_login_method&confirm=${await createLoginMethodConfirmation(u.id)}`), "google");
    expect(ok.status).toBe(302);
    const q = new URL(ok.headers.get("location")!).searchParams;
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("prompt")).toBe("select_account");
    expect(q.get("access_type")).toBeNull();
  });

  it("link_login_method connects the provider to the signed-in user and refuses one linked elsewhere", async () => {
    const u = await signIn();
    const res = await flow(
      "google",
      `intent=link_login_method&next=/app/settings/login&confirm=${await createLoginMethodConfirmation(u.id)}`,
      googleClaims({ sub: "g-link", email: "carla.personal@gmail.example" }),
    );
    expect(locationOf(res.callback!)).toBe("/app/settings/login?connected=google");
    const [acct] = await t.db.select().from(oauthAccounts);
    expect(acct).toMatchObject({ userId: u.id, providerAccountId: "g-link" });
    // Identity only: a new login method never connects a calendar.
    expect(calls.linkCalendar).toHaveLength(0);
    expect(await t.db.select().from(auditLog).where(and(eq(auditLog.action, "login_method.connected"), eq(auditLog.targetId, u.id)))).toHaveLength(1);

    resetRequest();
    const dora = await signIn("dora@example.com");
    const taken = await flow(
      "google",
      `intent=link_login_method&confirm=${await createLoginMethodConfirmation(dora.id)}`,
      googleClaims({ sub: "g-link", email: "carla.personal@gmail.example" }),
    );
    expect(locationOf(taken.callback!)).toBe("/app/settings/login?oauth_error=account_linked_elsewhere&provider=google");
  });

  it("poll_freebusy asks for free/busy only and goes to polls.handleVoterFreeBusyCallback without persisting anything", async () => {
    const start = await handleOAuthStart(new Request("http://localhost:3000/api/auth/google/start?intent=poll_freebusy&next=/p/abc&poll=abc"), "google");
    const q = new URL(start.headers.get("location")!).searchParams;
    expect(q.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.freebusy");
    expect(q.get("access_type")).toBeNull();
    const res = await flow("google", "intent=poll_freebusy&next=/p/abc&poll=abc", googleClaims({ sub: "voter" }));
    expect(res.callback!.status).toBe(200);
    expect(calls.poll).toHaveLength(1);
    expect(calls.poll[0]).toMatchObject({ intent: "poll_freebusy", returnTo: "/p/abc", state: { data: { poll: "abc" } }, userId: null });
    expect(await t.db.select().from(users)).toHaveLength(0);
    expect(await t.db.select().from(oauthAccounts)).toHaveLength(0);
    expect(await t.db.select().from(sessions)).toHaveLength(0);
  });
});
