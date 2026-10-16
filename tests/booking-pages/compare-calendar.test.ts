// Booking page "Compare with my calendar": the compare_calendar OAuth intent asks Google for free/busy and the calendar
// list only (no offline access, no events unless the visitor asks for event names), keeps the visitor's token sealed in their own browser (a cookie scoped to
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
const { eventTitle, failureReason, mergeRanges } = await import("@/lib/compare/google");
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
const READONLY = "https://www.googleapis.com/auth/calendar.readonly";

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
async function connect(next: string, opts: { extra?: string; scope?: string } = {}) {
  const start = await handleOAuthStart(new Request(`${ORIGIN}/api/auth/google/start?intent=compare_calendar&next=${encodeURIComponent(next)}${opts.extra ?? ""}`), "google");
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("location")!);
  const scope = opts.scope ?? `openid email ${FREEBUSY} ${CAL_LIST}`;
  const fm = mockFetch(...googleRoutes({}, { accessToken: "visitor-access", refreshToken: null, scope, idToken: fakeIdToken({ sub: "visitor-sub", email: "alex@example.com", email_verified: true }) }));
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

  it("asks to read events only when the visitor clicks Show event names, and remembers whether Google granted it", async () => {
    expect(google.googleScopesFor("compare_calendar", { events: "1" })).toEqual(["openid", "email", FREEBUSY, CAL_LIST, READONLY]);
    const asked = await connect("/julianjoseph/30min", { extra: "&events=1", scope: `openid email ${FREEBUSY} ${CAL_LIST} ${READONLY}` });
    expect(asked.authorize.searchParams.get("scope")).toBe(`openid email ${FREEBUSY} ${CAL_LIST} ${READONLY}`);
    expect(asked.authorize.searchParams.get("access_type")).toBeNull();
    const granted = cookieValue(setCookie(asked.callback, COMPARE_COOKIE)!);
    const listRoute = { method: "GET", url: "https://www.googleapis.com/calendar/v3/users/me/calendarList", handler: () => ({ items: [] }) };
    let fm = mockFetch(listRoute);
    expect((await (await compareRoute.GET(req("GET", COMPARE_API_PATH, granted), undefined)).json()).events).toBe(true);
    fm.restore();
    // The box left unchecked on Google's screen: a plain compare.
    const declined = await connect("/julianjoseph/30min", { extra: "&events=1" });
    fm = mockFetch(listRoute);
    expect((await (await compareRoute.GET(req("GET", COMPARE_API_PATH, cookieValue(setCookie(declined.callback, COMPARE_COOKIE)!)), undefined)).json()).events).toBe(false);
    fm.restore();
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
  async function sessionCookie(events = false): Promise<string> {
    const res = await appendCompareCookie(new Response(null), newCompareSession({ accessToken: "visitor-access", email: "alex@example.com", expiresAt: new Date(Date.now() + 3_600_000), events }));
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
      events: false,
      calendars: [
        { id: "alex@example.com", name: "Alex", color: "#039be5", primary: true, selected: true },
        { id: "family@x", name: "Family", color: null, primary: false, selected: true },
        { id: "work@x", name: "Work", color: "#f4511e", primary: false, selected: false },
      ],
    });
  });

  it("marks the calendars Google won't share busy times of, unchecked, so the panel grays them out", async () => {
    const cookie = await sessionCookie();
    const fm = mockFetch(
      {
        method: "GET",
        url: "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        handler: () => ({
          items: [
            { id: "alex@example.com", summary: "Alex", primary: true },
            { id: "en.usa#holiday@group.v.calendar.google.com", summary: "Holidays in United States", selected: true },
            { id: "family@x", summary: "Family", selected: true },
          ],
        }),
      },
      {
        method: "POST",
        url: "https://www.googleapis.com/calendar/v3/freeBusy",
        handler: (r) => {
          expect((r.body as { items: { id: string }[] }).items).toHaveLength(3);
          return {
            calendars: {
              "alex@example.com": { busy: [] },
              "en.usa#holiday@group.v.calendar.google.com": { errors: [{ reason: "notFound" }] },
              "family@x": { errors: [{ reason: "backendError" }] },
            },
          };
        },
      },
    );
    const res = await compareRoute.GET(req("GET", COMPARE_API_PATH, cookie), undefined);
    fm.restore();
    // A temporary error is left to the busy lookup to report; only notFound means it can't be compared.
    expect((await res.json()).calendars).toEqual([
      { id: "alex@example.com", name: "Alex", color: null, primary: true, selected: true },
      { id: "family@x", name: "Family", color: null, primary: false, selected: true },
      { id: "en.usa#holiday@group.v.calendar.google.com", name: "Holidays in United States", color: null, primary: false, selected: false, unreadable: true },
    ]);
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
        expect((r.body as { items: { id: string }[] }).items).toEqual([{ id: "primary" }, { id: "work@x" }, { id: "gone@x" }, { id: "flaky@x" }, { id: "missing@x" }]);
        return {
          calendars: {
            primary: { busy: [{ start: "2030-10-08T19:00:00Z", end: "2030-10-08T19:30:00Z" }] },
            "work@x": { busy: [{ start: "2030-10-08T19:15:00Z", end: "2030-10-08T20:00:00Z" }] },
            "gone@x": { errors: [{ reason: "notFound" }] },
            "flaky@x": { errors: [{ reason: "backendError" }] },
          },
        };
      },
    });
    const res = await busyRoute.POST(req("POST", `${COMPARE_API_PATH}/busy`, cookie, { calendarIds: ["primary", "work@x", "gone@x", "flaky@x", "missing@x"], start: "2030-10-01T00:00:00Z", end: "2030-11-01T00:00:00Z" }), undefined);
    fm.restore();
    expect(await res.json()).toEqual({ busy: [{ start: Date.parse("2030-10-08T19:00:00Z"), end: Date.parse("2030-10-08T20:00:00Z") }], failed: [
        { id: "gone@x", reason: "no_access" },
        { id: "flaky@x", reason: "temporary" },
        { id: "missing@x", reason: "no_access" },
      ],
      titles: [],
    });
    // Without the visitor's go-ahead no event is ever listed.
    expect(fm.callsTo("/events")).toHaveLength(0);
  });

  it("names the visitor's own events only when they allowed it, skipping what free/busy skips", async () => {
    const cookie = await sessionCookie(true);
    const at = (h: string) => `2030-10-08T${h}:00Z`;
    const fm = mockFetch(
      { method: "POST", url: "https://www.googleapis.com/calendar/v3/freeBusy", handler: () => ({ calendars: { primary: { busy: [{ start: at("19:00"), end: at("19:30") }] }, "shared@x": { busy: [] } } }) },
      {
        method: "GET",
        url: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        handler: (r) => {
          expect(r.url.searchParams.get("singleEvents")).toBe("true");
          expect(r.url.searchParams.get("timeMin")).toBe("2030-10-01T00:00:00.000Z");
          return {
            items: [
              { summary: "Dentist", start: { dateTime: at("19:00") }, end: { dateTime: at("19:30") } },
              { summary: "Lunch (free)", transparency: "transparent", start: { dateTime: at("20:00") }, end: { dateTime: at("21:00") } },
              { summary: "Moved", status: "cancelled", start: { dateTime: at("20:00") }, end: { dateTime: at("21:00") } },
              { summary: "Declined", attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: at("20:00") }, end: { dateTime: at("21:00") } },
              { summary: "Vacation", start: {}, end: {} },
              { start: { dateTime: at("22:00") }, end: { dateTime: at("23:00") } },
            ],
          };
        },
      },
      { method: "GET", url: "https://www.googleapis.com/calendar/v3/calendars/shared%40x/events", handler: () => mockResponse({ error: {} }, { status: 403 }) },
    );
    const res = await busyRoute.POST(req("POST", `${COMPARE_API_PATH}/busy`, cookie, { calendarIds: ["primary", "shared@x"], start: "2030-10-01T00:00:00Z", end: "2030-11-01T00:00:00Z" }), undefined);
    fm.restore();
    const out = await res.json();
    expect(out.titles).toEqual([{ start: Date.parse(at("19:00")), end: Date.parse(at("19:30")), title: "Dentist" }]);
    expect(out.busy).toEqual([{ start: Date.parse(at("19:00")), end: Date.parse(at("19:30")) }]);
  });

  it("keeps titles short", () => {
    expect(eventTitle({ summary: `  ${"x".repeat(200)} `, start: { dateTime: "2030-10-08T19:00:00Z" }, end: { dateTime: "2030-10-08T19:30:00Z" } })?.title).toHaveLength(80);
  });

  it("explains each Google free/busy error in the visitor's terms", () => {
    expect(failureReason(["notFound"])).toBe("no_access");
    expect(failureReason([])).toBe("no_access");
    expect(failureReason(["internalError"])).toBe("temporary");
    expect(failureReason(["backendError"])).toBe("temporary");
    expect(failureReason(["groupTooBig"])).toBe("too_many");
    expect(failureReason(["tooManyCalendarsRequested"])).toBe("too_many");
    expect(failureReason(["somethingNew"])).toBe("unknown");
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
