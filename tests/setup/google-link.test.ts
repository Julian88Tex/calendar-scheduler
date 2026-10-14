// "Continue with Google" after the owner bootstrap (src/lib/auth/flows/oauth-accounts.ts step 2): the verified Google
// email links to the bootstrapped account (no second account, the setup intact), and an account without a picture
// adopts the Google profile picture; a picture the account already has is kept. Runs the real start and callback
// routes against mocked Google endpoints; calendars.linkCalendarFromOAuth (calendar-integrations) is mocked.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ linkCalendar: [] as { userId: string }[] }));
const cookieJar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    getAll: () => [...cookieJar.entries()].map(([name, value]) => ({ name, value })),
    has: (name: string) => cookieJar.has(name),
    set: (name: string, value: string, opts: { maxAge?: number } = {}) => {
      if (opts.maxAge === 0 || value === "") cookieJar.delete(name);
      else cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.9", host: "localhost:3000" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/calendars", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/calendars")>()),
  linkCalendarFromOAuth: async (p: { userId: string }) => {
    calls.linkCalendar.push(p);
  },
}));

const { eventTypes, handles, instanceSettings, oauthAccounts, organizations, users } = await import("@/db/schema");
const { bootstrapOwner } = await import("@/lib/setup/bootstrap");
const { resolveOAuthLogin } = await import("@/lib/auth/flows/oauth-accounts");
const { handleOAuthCallback, handleOAuthStart } = await import("@/lib/auth/oauth/flow");
const { SESSION_COOKIE, lookupSession } = await import("@/lib/auth/session");
const { useTestDb } = await import("../helpers/db");
const { fakeIdToken, googleRoutes, mockFetch } = await import("../helpers/fake-providers");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const OWNER = "julian@example.com";
const PHOTO = "https://lh3.googleusercontent.com/a/julian-photo";

beforeAll(() => {
  env.GOOGLE_CLIENT_ID = "google-client";
  env.GOOGLE_CLIENT_SECRET = "google-secret";
  env.SIGNUP_POLICY = "invite_only";
});
afterAll(() => {
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
  delete env.SIGNUP_POLICY;
});
beforeEach(async () => {
  cookieJar.clear();
  calls.linkCalendar.length = 0;
  await t.db.delete(users);
  await t.db.delete(organizations);
  await t.db.delete(handles);
  await t.db.delete(instanceSettings);
});

const claims = (over: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  sub: "google-sub-julian",
  email: "Julian@Example.com",
  email_verified: true,
  name: "Julian Joseph",
  picture: PHOTO,
  ...over,
});

/** Start then callback of "Continue with Google" (intent login) with Google's token endpoint mocked. */
async function continueWithGoogle(c: Record<string, unknown>) {
  const start = await handleOAuthStart(new Request("http://localhost:3000/api/auth/google/start?intent=login"), "google");
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const fm = mockFetch(...googleRoutes({}, { idToken: fakeIdToken(c) }));
  try {
    return await handleOAuthCallback(
      new Request(`http://localhost:3000/api/auth/google/callback?code=auth-code-1&state=${encodeURIComponent(state)}`),
      "google",
    );
  } finally {
    fm.restore();
  }
}

describe("Google sign-in into the bootstrapped account", () => {
  it("links to it, adopts the Google picture and keeps the whole setup", async () => {
    const boot = await bootstrapOwner({ email: OWNER }, { db: t.db });
    expect(boot.user.avatarUrl).toBeNull();

    const res = await continueWithGoogle(claims());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/app\/scheduling$/);

    const all = await t.db.select().from(users);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: boot.user.id, avatarUrl: PHOTO, name: "Julian Joseph", slug: "julianjoseph", isInstanceAdmin: true, passwordHash: null });
    const [link] = await t.db.select().from(oauthAccounts);
    expect(link).toMatchObject({ userId: boot.user.id, provider: "google", providerAccountId: "google-sub-julian", emailNormalized: OWNER });
    expect(calls.linkCalendar.map((c) => c.userId)).toEqual([boot.user.id]);
    expect((await lookupSession(t.db, cookieJar.get(SESSION_COOKIE)))?.user.id).toBe(boot.user.id);
    const types = await t.db.select().from(eventTypes).where(eq(eventTypes.ownerUserId, boot.user.id));
    expect(types.map((e) => e.slug).sort()).toEqual(["30min", "60min", "meal"]);

    // Signing in again logs in through the link and leaves the picture alone.
    await t.db.update(users).set({ avatarUrl: "https://example.com/changed.png" }).where(eq(users.id, boot.user.id));
    const again = await continueWithGoogle(claims({ picture: "https://lh3.googleusercontent.com/a/new" }));
    expect(again.status).toBe(303);
    const [u] = await t.db.select().from(users).where(eq(users.id, boot.user.id));
    expect(u?.avatarUrl).toBe("https://example.com/changed.png");
  });

  it("keeps a picture the account already has", async () => {
    const boot = await bootstrapOwner({ email: OWNER, avatarUrl: "https://example.com/mine.png" }, { db: t.db });
    const res = await resolveOAuthLogin({
      provider: "google",
      profile: { providerAccountId: "google-sub-julian", email: OWNER, emailVerified: true, name: "Julian Joseph", avatarUrl: PHOTO },
      db: t.db,
    });
    expect(res).toMatchObject({ linked: true, created: false });
    expect(res.user.avatarUrl).toBe("https://example.com/mine.png");
    const [u] = await t.db.select().from(users).where(eq(users.id, boot.user.id));
    expect(u?.avatarUrl).toBe("https://example.com/mine.png");
  });

  it("keeps an uploaded avatar, and adopts nothing that is not https", async () => {
    const boot = await bootstrapOwner({ email: OWNER }, { db: t.db });
    const plain = await resolveOAuthLogin({
      provider: "google",
      profile: { providerAccountId: "google-sub-julian", email: OWNER, emailVerified: true, name: null, avatarUrl: "http://insecure.example/a.png" },
      db: t.db,
    });
    expect(plain.user.avatarUrl).toBeNull();
    const [u] = await t.db.select().from(users).where(eq(users.id, boot.user.id));
    expect(u?.avatarUrl).toBeNull();
  });

  it("does not let an unverified Google email in", async () => {
    await bootstrapOwner({ email: OWNER }, { db: t.db });
    await expect(
      resolveOAuthLogin({
        provider: "google",
        profile: { providerAccountId: "google-sub-other", email: OWNER, emailVerified: false, name: null, avatarUrl: PHOTO },
        db: t.db,
      }),
    ).rejects.toMatchObject({ code: "email_unverified" });
    expect(await t.db.select().from(oauthAccounts)).toHaveLength(0);
  });

  it("does not let another Google account sign up next to the owner (invite only)", async () => {
    await bootstrapOwner({ email: OWNER }, { db: t.db });
    const res = await continueWithGoogle(claims({ sub: "google-sub-stranger", email: "stranger@example.com" }));
    expect(res.headers.get("location")).toContain("error=signups_closed");
    expect(await t.db.select().from(users)).toHaveLength(1);
  });
});
