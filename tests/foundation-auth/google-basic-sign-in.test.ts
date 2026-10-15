// Basic-scope Google sign-in (docs/GOOGLE_VERIFICATION.md): login, link_login_method and accept_invitation ask Google
// only for openid, email and profile (prompt=select_account, no offline access), so Google's unverified app warning
// never shows on an everyday sign-in; signup and connect_calendar (first connect and every Reconnect) keep the full
// list with consent and offline access. A basic sign-in still finds the owner by Google subject or verified email, and
// never changes the stored Google calendar connection (tokens, scopes, Gmail send permission, status, health): Gmail
// sending keeps working afterwards. Runs the real start and callback routes and the real calendars module against
// mocked Google endpoints (nothing about calendars is mocked here).
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);
vi.mock("next/cache", async () => (await import("./_request")).nextCacheMock);
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { calendarConnections, calendars, emailOutbox, instanceSettings, jobs, oauthAccounts, organizations, users } = await import("@/db/schema");
const { handleOAuthCallback, handleOAuthStart } = await import("@/lib/auth/oauth/flow");
const google = await import("@/lib/auth/oauth/google");
const { OAUTH_INTENTS } = await import("@/lib/auth/oauth/types");
const { SESSION_COOKIE, lookupSession } = await import("@/lib/auth/session");
const { decrypt } = await import("@/lib/crypto");
const email = await import("@/lib/email");
const { ownerGoogleConnections } = await import("@/lib/email/gmail-sender");
const { GMAIL_SEND_SCOPE } = await import("@/lib/integrations/google/scopes");
const { useTestDb } = await import("../helpers/db");
const { createUser } = await import("../factories");
const { fakeIdToken, googleRoutes, mockFetch } = await import("../helpers/fake-providers");
const h = await import("../email-gmail/helpers");
const { jar, locationOf, resetRequest } = await import("./_request");

type TokenOptions = { accessToken?: string; refreshToken?: string | null; scope?: string };

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const SUB = "google-sub-julian";
const OWNER_EMAIL = "julian@gmail.example";
const SIGN_IN = "openid email profile";
const FULL = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  GMAIL_SEND_SCOPE,
];

beforeAll(() => {
  env.GOOGLE_CLIENT_ID = "google-client";
  env.GOOGLE_CLIENT_SECRET = "google-secret";
});
afterAll(() => {
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
});
beforeEach(async () => {
  resetRequest();
  delete env.EMAIL_PROVIDER;
  await t.db.delete(users);
  await t.db.delete(organizations);
  await t.db.delete(jobs);
  await t.db.delete(emailOutbox);
  await t.db.delete(instanceSettings);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete env.EMAIL_PROVIDER;
});

const claims = (over: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  sub: SUB,
  email: OWNER_EMAIL,
  email_verified: true,
  name: "Julian Joseph",
  picture: "https://lh3.googleusercontent.com/a/julian",
  ...over,
});

/** The owner with a healthy Google connection that allowed Gmail sending (the live setup). */
async function ownerWithGoogle(opts: { linkedLogin?: boolean; connection?: boolean; status?: "active" | "needs_reauth" } = {}) {
  const owner = await createUser(t.db, { name: "Julian Joseph", email: OWNER_EMAIL, slug: "julianjoseph", isInstanceAdmin: true });
  if (opts.linkedLogin ?? true) {
    await t.db.insert(oauthAccounts).values({ userId: owner.id, provider: "google", providerAccountId: SUB, email: OWNER_EMAIL, emailNormalized: OWNER_EMAIL });
  }
  if (opts.connection === false) return { owner, conn: null };
  const conn = await h.connectGoogle(t.db, owner, { address: OWNER_EMAIL, status: opts.status ?? "active" });
  // The connection belongs to the Google account the owner signs in with.
  await t.db
    .update(calendarConnections)
    .set({
      providerAccountId: SUB,
      ...(opts.status === "needs_reauth" ? { lastError: "Token has been expired or revoked.", lastErrorAt: new Date(), consecutiveFailures: 3 } : {}),
    })
    .where(eq(calendarConnections.id, conn.id));
  await t.db.update(users).set({ destinationCalendarId: (await t.db.select().from(calendars).where(eq(calendars.connectionId, conn.id)))[0]!.id }).where(eq(users.id, owner.id));
  return { owner, conn };
}

/** Everything a calendar link could touch: the connections, their calendars, the destination and the calendar jobs. */
async function calendarState(userId: string) {
  const conns = await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId)).orderBy(calendarConnections.id);
  const cals = await t.db.select().from(calendars).where(eq(calendars.userId, userId)).orderBy(calendars.id);
  const [user] = await t.db.select({ destination: users.destinationCalendarId, preferences: users.preferences }).from(users).where(eq(users.id, userId));
  const queued = (await t.db.select({ id: jobs.id, type: jobs.type, payload: jobs.payload }).from(jobs).orderBy(jobs.id)).filter((j) => j.type.startsWith("calendars."));
  return { conns, cals, user, queued };
}

/** "Continue with Google" on the login page, then Google's callback with the token endpoint mocked. */
async function googleSignIn(query: string, c: Record<string, unknown>, token: TokenOptions) {
  const start = await handleOAuthStart(new Request(`http://localhost:3000/api/auth/google/start${query ? `?${query}` : ""}`), "google");
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("location")!);
  const fm = mockFetch(...googleRoutes({}, { idToken: fakeIdToken(c), ...token }));
  try {
    const callback = await handleOAuthCallback(
      new Request(`http://localhost:3000/api/auth/google/callback?code=auth-code-1&state=${encodeURIComponent(authorize.searchParams.get("state")!)}`),
      "google",
    );
    return { authorize, callback, requests: fm.calls.map((r) => `${r.method} ${r.url.origin}${r.url.pathname}`) };
  } finally {
    fm.restore();
  }
}

const signedInUserId = async () => (await lookupSession(t.db, jar.get(SESSION_COOKIE)))?.user.id ?? null;

describe("scopes per intent", () => {
  it("login, link_login_method and accept_invitation identify the user only; signup and connect_calendar ask for everything", () => {
    const access = Object.fromEntries(OAUTH_INTENTS.map((i) => [i, google.googleAccessFor(i)]));
    expect(access).toEqual({
      login: "sign_in",
      signup: "full",
      connect_calendar: "full",
      poll_freebusy: "freebusy",
      link_login_method: "sign_in",
      accept_invitation: "sign_in",
    });
    expect(google.GOOGLE_SIGN_IN_SCOPES).toEqual(["openid", "email", "profile"]);
    expect(google.GOOGLE_SCOPES).toEqual(FULL);
    for (const intent of ["login", "link_login_method", "accept_invitation"] as const) {
      expect(google.googleScopesFor(intent)).toEqual(["openid", "email", "profile"]);
      const q = google.googleAuthorizationUrl({ state: "s", codeVerifier: "v".repeat(43), intent }).searchParams;
      expect(q.get("scope"), intent).toBe(SIGN_IN);
      expect(q.get("prompt"), intent).toBe("select_account");
      expect(q.get("access_type"), intent).toBeNull();
      expect(q.get("include_granted_scopes"), intent).toBeNull();
    }
    for (const intent of ["signup", "connect_calendar"] as const) {
      expect(google.googleScopesFor(intent)).toEqual(FULL);
      const q = google.googleAuthorizationUrl({ state: "s", codeVerifier: "v".repeat(43), intent, loginHint: OWNER_EMAIL }).searchParams;
      expect(q.get("scope"), intent).toBe(FULL.join(" "));
      expect(q.get("prompt"), intent).toBe("consent");
      expect(q.get("access_type"), intent).toBe("offline");
      expect(q.get("include_granted_scopes"), intent).toBe("true");
      expect(q.get("login_hint"), intent).toBe(OWNER_EMAIL);
    }
    const voter = google.googleAuthorizationUrl({ state: "s", codeVerifier: "v".repeat(43), intent: "poll_freebusy" }).searchParams;
    expect(voter.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.freebusy");
    expect(voter.get("prompt")).toBe("select_account");
    expect(voter.get("access_type")).toBeNull();
  });
});

describe("a basic-scope Google sign-in", () => {
  it("signs the owner in by Google subject and leaves the stored connection byte for byte unchanged", async () => {
    const { owner } = await ownerWithGoogle();
    const before = await calendarState(owner.id);
    expect(before.conns).toHaveLength(1);

    const res = await googleSignIn("next=/app/meetings", claims(), { refreshToken: null, scope: SIGN_IN });
    expect(res.authorize.searchParams.get("scope")).toBe(SIGN_IN);
    expect(locationOf(res.callback)).toBe("/app/meetings");
    expect(await signedInUserId()).toBe(owner.id);
    // Only the token endpoint: no calendar list, events or Gmail call on the sign-in path.
    expect(res.requests).toEqual(["POST https://oauth2.googleapis.com/token"]);
    expect(await calendarState(owner.id)).toEqual(before);
    expect(await t.db.select().from(oauthAccounts)).toHaveLength(1);
  });

  it("links by verified email when the Google account was never used to sign in, without touching the connection", async () => {
    const { owner } = await ownerWithGoogle({ linkedLogin: false });
    const before = await calendarState(owner.id);

    const res = await googleSignIn("", claims({ email: "Julian@Gmail.Example" }), { refreshToken: null, scope: SIGN_IN });
    expect(locationOf(res.callback)).toBe("/app/scheduling");
    expect(await signedInUserId()).toBe(owner.id);
    const [link] = await t.db.select().from(oauthAccounts);
    expect(link).toMatchObject({ userId: owner.id, provider: "google", providerAccountId: SUB });
    expect(await t.db.select().from(users)).toHaveLength(1);
    expect(await calendarState(owner.id)).toEqual(before);
  });

  it("ignores whatever the token response claims (earlier grants listed, a refresh token): nothing is stored", async () => {
    const { owner, conn } = await ownerWithGoogle();
    const before = await calendarState(owner.id);

    const res = await googleSignIn("", claims(), { accessToken: "at-sign-in", refreshToken: "rt-sign-in", scope: FULL.join(" ") });
    expect(locationOf(res.callback)).toBe("/app/scheduling");
    expect(await signedInUserId()).toBe(owner.id);
    expect(await calendarState(owner.id)).toEqual(before);
    const [row] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.id, conn!.id));
    expect(await decrypt(row!.accessTokenEnc!)).toBe("access-1");
    expect(await decrypt(row!.refreshTokenEnc!)).toBe("refresh-1");
  });

  it("neither repairs nor downgrades a connection that needs a reconnect (the Reconnect link does that)", async () => {
    const { owner } = await ownerWithGoogle({ status: "needs_reauth" });
    const before = await calendarState(owner.id);
    await googleSignIn("", claims(), { refreshToken: null, scope: SIGN_IN });
    expect(await signedInUserId()).toBe(owner.id);
    const after = await calendarState(owner.id);
    expect(after).toEqual(before);
    expect(after.conns[0]).toMatchObject({ status: "needs_reauth", consecutiveFailures: 3 });
  });

  it("creates no calendar connection for a user who has none (the app keeps offering Connect)", async () => {
    const { owner } = await ownerWithGoogle({ connection: false });
    const res = await googleSignIn("", claims(), { refreshToken: null, scope: SIGN_IN });
    expect(locationOf(res.callback)).toBe("/app/scheduling");
    expect(await signedInUserId()).toBe(owner.id);
    expect(await calendarState(owner.id)).toMatchObject({ conns: [], cals: [], queued: [] });
  });

  it("keeps Gmail sending working: the owner's emails still go out from Gmail with the stored token", async () => {
    const { owner, conn } = await ownerWithGoogle();
    await googleSignIn("", claims(), { refreshToken: null, scope: SIGN_IN });
    expect(await signedInUserId()).toBe(owner.id);

    expect(await ownerGoogleConnections(owner.id)).toEqual([expect.objectContaining({ id: conn!.id, address: OWNER_EMAIL, status: "active", hasGmailSend: true })]);
    const fake = h.fakeGmail();
    try {
      const sent = await email.sendEmail({
        to: ["Sam Rivera <sam@example.com>"],
        subject: "Confirmed: 30 Minute Virtual with Julian Joseph",
        html: "<p>Your meeting is confirmed.</p>",
        text: "Your meeting is confirmed.",
        template: "lifecycle.invitee_confirmation",
        category: "transactional",
        idempotencyKey: "basic-sign-in:gmail",
      });
      expect(sent.status).toBe("sent");
      const [row] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, sent.id));
      expect(row).toMatchObject({ status: "sent", provider: "gmail", fromAddress: OWNER_EMAIL });
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]!.authorization).toBe("Bearer access-1");
      expect(fake.tokenCalls).toHaveLength(0);
    } finally {
      fake.restore();
    }
  });
});

describe("signup still connects the calendar (CAL-17)", () => {
  it("asks for every scope with consent and offline access and creates the connection with gmail.send", async () => {
    env.EMAIL_PROVIDER = "outbox";
    const res = await googleSignIn("intent=signup", claims(), { accessToken: "at-signup", refreshToken: "rt-signup", scope: FULL.join(" ") });
    const q = res.authorize.searchParams;
    expect(q.get("scope")).toBe(FULL.join(" "));
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("access_type")).toBe("offline");
    expect(locationOf(res.callback)).not.toContain("error");
    const [u] = await t.db.select().from(users);
    expect(await signedInUserId()).toBe(u!.id);
    const conns = await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, u!.id));
    expect(conns).toHaveLength(1);
    expect(conns[0]).toMatchObject({ provider: "google", providerAccountId: SUB, status: "active", scopes: FULL });
    expect(await decrypt(conns[0]!.refreshTokenEnc!)).toBe("rt-signup");
  });
});
