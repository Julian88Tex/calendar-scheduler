// Booking page "Compare with my calendar": the compare_calendar OAuth intent asks Google for free/busy and the calendar
// list only (no offline access, no events), keeps the visitor's token sealed in their own browser (a cookie scoped to
// the compare API, an hour at most) and writes nothing to the database. Runs the real start and callback and the real
// compare routes against mocked Google endpoints.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../foundation-auth/_request")).nextHeadersMock);
vi.mock("next/cache", async () => (await import("../foundation-auth/_request")).nextCacheMock);
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { calendarConnections, oauthAccounts, sessions, users } = await import("@/db/schema");
const { handleOAuthCallback, handleOAuthStart } = await import("@/lib/auth/oauth/flow");
const google = await import("@/lib/auth/oauth/google");
const { COMPARE_API_PATH, COMPARE_COOKIE } = await import("@/lib/compare/constants");
const { mergeRanges } = await import("@/lib/compare/google");
const { newCompareSession, appendCompareCookie } = await import("@/lib/compare/session");
const compareRoute = await import("@/app/api/public/compare/route");
const busyRoute = await import("@/app/api/public/compare/busy/route");
const { useTestDb } = await import("../helpers/db");
const { fakeIdToken, googleRoutes, mockFetch, mockResponse } = await import("../helpers/fake-providers");
const { jar, locationOf, resetRequest } = await import("../foundation-auth/_request");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const ORIGIN = "http://localhost:3000";
const FREEBUSY = "https://www.googleapis.com/auth/calendar.freebusy";
const CAL_LIST = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

beforeAll(() => {
  env.GOOGLE_CLIENT_ID = "google-client";
  env.GOOGLE_CLIENT_SECRET = "google-secret";
});
afterAll(() => {
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
});
beforeEach(() => resetRequest());
afterEach(() => vi.unstubAllGlobals());

/** The Set-Cookie header of a response for one cookie name. */
function setCookie(res: Response, name: string): string | null {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? null;
}
const cookieValue = (header: string) => decodeURIComponent(header.split(";")[0]!.slice(header.indexOf("=") + 1));

/** Start, Google consent (mocked), callback: returns the authorize URL and the callback response. */
async function connect(next: string) {
  const start = await handleOAuthStart(new Request(`${ORIGIN}/api/auth/google/start?intent=compare_calendar&next=${encodeURIComponent(next)}`), "google");
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("location")!);
  const fm = mockFetch(...googleRoutes({}, { accessToken: "visitor-access", refreshToken: null, scope: `openid email ${FREEBUSY} ${CAL_LIST}`, idToken: fakeIdToken({ sub: "visitor-sub", email: "alex@example.com", email_verified: true }) }));
  try {
    const callback = await handleOAuthCallback(new Request(`${ORIGIN}/api/auth/google/callback?code=c1&state=${encodeURIComponent(authorize.searchParams.get("state")!)}`), "google");
    return { authorize, callback };
  } finally {
    fm.restore();
  }
}

function req(method: string, path: string, cookie: string | null, body?: unknown, origin = ORIGIN): Request {
  const headers: Record<string, string> = { origin, "content-type": "application/json" };
  if (cookie) headers.cookie = `${COMPARE_COOKIE}=${encodeURIComponent(cookie)}`;
  return new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("compare_calendar OAuth", () => {
  it("asks for free/busy and the calendar list only, with no offline access", () => {
    expect(google.googleAccessFor("compare_calendar")).toBe("compare");
    expect(google.googleScopesFor("compare_calendar")).toEqual(["openid", "email", FREEBUSY, CAL_LIST]);
    const q = google.googleAuthorizationUrl({ state: "s", codeVerifier: "v".repeat(43), intent: "compare_calendar" }).searchParams;
    expect(q.get("scope")).toBe(`openid email ${FREEBUSY} ${CAL_LIST}`);
    expect(q.get("prompt")).toBe("select_account");
    expect(q.get("access_type")).toBeNull();
    expect(q.get("include_granted_scopes")).toBeNull();
  });

  it("seals the token into a cookie for the compare API only, returns with ?compare=1 and stores nothing", async () => {
    const { callback } = await connect("/julianjoseph/30min?month=2030-10");
    expect(callback.status).toBe(303);
    expect(locationOf(callback)).toBe("/julianjoseph/30min?month=2030-10&compare=1");
    const header = setCookie(callback, COMPARE_COOKIE)!;
    expect(header).toContain(`Path=${COMPARE_API_PATH}`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    const maxAge = Number(/Max-Age=(\d+)/.exec(header)![1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(3600);
    expect(cookieValue(header)).not.toContain("visitor-access");
    // No account, session, user or calendar connection came out of it.
    for (const table of [users, oauthAccounts, sessions, calendarConnections]) expect(await t.db.select().from(table)).toHaveLength(0);
    expect(jar.size).toBe(0);
  });

  it("is Google only", async () => {
    env.MICROSOFT_CLIENT_ID = "ms-client";
    env.MICROSOFT_CLIENT_SECRET = "ms-secret";
    try {
      const start = await handleOAuthStart(new Request(`${ORIGIN}/api/auth/microsoft/start?intent=compare_calendar&next=/julianjoseph/30min`), "microsoft");
      expect(locationOf(start)).toBe("/julianjoseph/30min?oauth_error=not_configured&provider=microsoft");
    } finally {
      delete env.MICROSOFT_CLIENT_ID;
      delete env.MICROSOFT_CLIENT_SECRET;
    }
  });
});

describe("compare API", () => {
  async function sessionCookie(): Promise<string> {
    const res = await appendCompareCookie(new Response(null), newCompareSession({ accessToken: "visitor-access", email: "alex@example.com", expiresAt: new Date(Date.now() + 3_600_000) }));
    return cookieValue(setCookie(res, COMPARE_COOKIE)!);
  }

  it("lists the visitor's calendars, primary first, hidden ones left out", async () => {
    const cookie = await sessionCookie();
    const fm = mockFetch({
      method: "GET",
      url: "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      handler: (r) => {
        expect(r.headers.get("authorization")).toBe("Bearer visitor-access");
        expect(r.url.searchParams.get("minAccessRole")).toBe("freeBusyReader");
        return {
          items: [
            { id: "work@x", summary: "Work", backgroundColor: "#f4511e" },
            { id: "hidden@x", summary: "Hidden", hidden: true },
            { id: "alex@example.com", summary: "alex@example.com", summaryOverride: "Alex", primary: true, backgroundColor: "#039be5" },
            { id: "family@x", summary: "Family", selected: true, backgroundColor: "javascript:alert(1)" },
          ],
        };
      },
    });
    const res = await compareRoute.GET(req("GET", COMPARE_API_PATH, cookie), undefined);
    fm.restore();
    expect(await res.json()).toEqual({
      connected: true,
      email: "alex@example.com",
      expiresAt: expect.any(String),
      calendars: [
        { id: "alex@example.com", name: "Alex", color: "#039be5", primary: true, selected: true },
        { id: "family@x", name: "Family", color: null, primary: false, selected: true },
        { id: "work@x", name: "Work", color: "#f4511e", primary: false, selected: false },
      ],
    });
  });

  it("falls back to the primary calendar without the calendar list permission", async () => {
    const cookie = await sessionCookie();
    const fm = mockFetch({ method: "GET", url: "https://www.googleapis.com/calendar/v3/users/me/calendarList", handler: () => mockResponse({ error: {} }, { status: 403 }) });
    const res = await compareRoute.GET(req("GET", COMPARE_API_PATH, cookie), undefined);
    fm.restore();
    expect((await res.json()).calendars).toEqual([{ id: "primary", name: "alex@example.com", color: null, primary: true, selected: true }]);
  });

  it("returns merged busy ranges of the chosen calendars and the ones Google could not read", async () => {
    const cookie = await sessionCookie();
    const fm = mockFetch({
      method: "POST",
      url: "https://www.googleapis.com/calendar/v3/freeBusy",
      handler: (r) => {
        expect((r.body as { items: { id: string }[] }).items).toEqual([{ id: "primary" }, { id: "work@x" }, { id: "gone@x" }]);
        return {
          calendars: {
            primary: { busy: [{ start: "2030-10-08T19:00:00Z", end: "2030-10-08T19:30:00Z" }] },
            "work@x": { busy: [{ start: "2030-10-08T19:15:00Z", end: "2030-10-08T20:00:00Z" }] },
            "gone@x": { errors: [{ reason: "notFound" }] },
          },
        };
      },
    });
    const res = await busyRoute.POST(req("POST", `${COMPARE_API_PATH}/busy`, cookie, { calendarIds: ["primary", "work@x", "gone@x"], start: "2030-10-01T00:00:00Z", end: "2030-11-01T00:00:00Z" }), undefined);
    fm.restore();
    expect(await res.json()).toEqual({ busy: [{ start: Date.parse("2030-10-08T19:00:00Z"), end: Date.parse("2030-10-08T20:00:00Z") }], failed: ["gone@x"] });
  });

  it("ends the connection when Google rejects the token", async () => {
    const cookie = await sessionCookie();
    const fm = mockFetch({ method: "POST", url: "https://www.googleapis.com/calendar/v3/freeBusy", handler: () => mockResponse({}, { status: 401 }) });
    const res = await busyRoute.POST(req("POST", `${COMPARE_API_PATH}/busy`, cookie, { calendarIds: ["primary"], start: "2030-10-01T00:00:00Z", end: "2030-10-30T00:00:00Z" }), undefined);
    fm.restore();
    expect(res.status).toBe(401);
    expect(setCookie(res, COMPARE_COOKIE)).toContain("Max-Age=0");
  });

  it("refuses missing, tampered and expired connections, cross-site posts and long ranges", async () => {
    const body = { calendarIds: ["primary"], start: "2030-10-01T00:00:00Z", end: "2030-10-30T00:00:00Z" };
    expect((await busyRoute.POST(req("POST", `${COMPARE_API_PATH}/busy`, null, body), undefined)).status).toBe(401);
    expect((await busyRoute.POST(req("POST", `${COMPARE_API_PATH}/busy`, "not-a-sealed-value", body), undefined)).status).toBe(401);
    const expired = await appendCompareCookie(new Response(null), newCompareSession({ accessToken: "a", email: "a@x", expiresAt: new Date(Date.now() - 1000) }));
    expect((await compareRoute.GET(req("GET", COMPARE_API_PATH, cookieValue(setCookie(expired, COMPARE_COOKIE)!)), undefined).then((r) => r.json()))).toEqual({ connected: false });
    const cookie = await sessionCookie();
    expect((await busyRoute.POST(req("POST", `${COMPARE_API_PATH}/busy`, cookie, body, "https://evil.example"), undefined)).status).toBe(403);
    expect((await busyRoute.POST(req("POST", `${COMPARE_API_PATH}/busy`, cookie, { ...body, end: "2030-12-30T00:00:00Z" }), undefined)).status).toBe(400);
  });

  it("Disconnect deletes the cookie", async () => {
    const res = await compareRoute.DELETE(req("DELETE", COMPARE_API_PATH, await sessionCookie()), undefined);
    expect(await res.json()).toEqual({ ok: true });
    expect(setCookie(res, COMPARE_COOKIE)).toContain("Max-Age=0");
  });
});

describe("mergeRanges", () => {
  it("sorts, joins overlapping and touching ranges and drops empty ones", () => {
    expect(mergeRanges([{ start: 5, end: 7 }, { start: 1, end: 3 }, { start: 3, end: 4 }, { start: 6, end: 9 }, { start: 10, end: 10 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 9 },
    ]);
  });
});
