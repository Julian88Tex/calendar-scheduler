// Free/busy only calendars on PGlite with the real credentials path (no withConnection mock), through a fake Google API:
// - a 401 that a token refresh fixes leaves the connection healthy: the retry of the busy fetch starts clean, so the
//   first attempt's error is not rethrown after a successful retry (which would flag the connection needs_reauth);
// - FreeBusy intervals are clipped to the asked window, so one window's refresh never wipes a neighbouring window's
//   busy times, even if Google answered with intervals reaching past the window.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockRequest } from "../helpers/fake-providers";

vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { calendarConnections, calendars } = await import("@/db/schema");
const { GOOGLE_FREE_BUSY_ONLY_TAG } = await import("@/lib/calendars/access");
const { getExternalBusy, WINDOW_MS } = await import("@/lib/calendars/busy");
const { mockFetch, mockResponse } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { DAY, HOUR, setupGoogle } = await import("./helpers");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const G = "https://www.googleapis.com/calendar/v3";
const ME = "me@example.com";
const WORK = "jjoseph@copado.com";

beforeEach(() => {
  env.GOOGLE_CLIENT_ID = "google-client";
  env.GOOGLE_CLIENT_SECRET = "google-secret";
});
afterEach(() => {
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
});

/** The owner's account: the primary calendar (readable, no events) and the checked work calendar (free/busy only). */
async function owner(accessToken: string) {
  const g = await setupGoogle(t.db, {
    encrypted: { accessToken, refreshToken: "refresh-1", expiresAt: new Date(Date.now() + HOUR) },
    calendars: [{ externalId: ME, name: ME, isPrimary: true, canWrite: true, checkConflicts: true }],
  });
  const [work] = await t.db
    .insert(calendars)
    .values({ connectionId: g.connectionId, userId: g.user.id, externalId: WORK, name: WORK, canWrite: false, checkConflicts: true, ctag: GOOGLE_FREE_BUSY_ONLY_TAG })
    .returning();
  return { ...g, work: work! };
}

type Busy = { start: string; end: string };

/** Fake Google: token refresh, FreeBusy (intervals overlapping the asked range, not clipped) and events.list. */
function google(p: { busy: () => Busy[]; badToken?: string }) {
  const unauthorized = (req: MockRequest) =>
    p.badToken && req.headers.get("authorization") === `Bearer ${p.badToken}`
      ? mockResponse({ error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } }, { status: 401 })
      : null;
  return mockFetch(
    { method: "POST", url: "https://oauth2.googleapis.com/token", handler: () => ({ access_token: "fresh-access", token_type: "Bearer", expires_in: 3599 }) },
    {
      method: "POST",
      url: `${G}/freeBusy`,
      handler: (req: MockRequest) => {
        const denied = unauthorized(req);
        if (denied) return denied;
        const body = req.body as { timeMin: string; timeMax: string; items: { id: string }[] };
        const min = Date.parse(body.timeMin);
        const max = Date.parse(body.timeMax);
        const overlapping = p.busy().filter((b) => Date.parse(b.start) < max && Date.parse(b.end) > min);
        return { calendars: Object.fromEntries(body.items.map((i) => [i.id, { busy: i.id === WORK ? overlapping : [] }])) };
      },
    },
    {
      method: "GET",
      url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/([^/]+)/events(?:\\?|$)`),
      handler: (req: MockRequest) => unauthorized(req) ?? { items: [] },
    },
  );
}

/** A day well inside one 31-day window (a range of a few hours needs exactly one window). */
function midWindow(): number {
  const now = Date.now();
  const start = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  let at = start + 15 * DAY;
  if (at < now + 2 * DAY) at = start + WINDOW_MS + 15 * DAY;
  return Math.floor(at / DAY) * DAY;
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("free/busy only calendars, real credentials", () => {
  it("keeps the connection healthy when a 401 is fixed by a token refresh", async () => {
    const o = await owner("revoked-access");
    const day = midWindow();
    const f = google({ busy: () => [{ start: iso(day + 17 * HOUR), end: iso(day + 18 * HOUR) }], badToken: "revoked-access" });
    try {
      const r = await getExternalBusy({ userIds: [o.user.id], start: new Date(day + 8 * HOUR), end: new Date(day + 22 * HOUR), maxAgeSeconds: 0 });
      expect(f.callsTo("oauth2.googleapis.com/token")).toHaveLength(1);
      expect(r[o.user.id]).toMatchObject({ ok: true, stale: false, nocal: false });
      expect(r[o.user.id]!.busy.map((b) => [b.title, iso(b.start.getTime()), iso(b.end.getTime())])).toEqual([[`Busy (${WORK})`, iso(day + 17 * HOUR), iso(day + 18 * HOUR)]]);
      const [conn] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.id, o.connectionId));
      expect(conn).toMatchObject({ status: "active", consecutiveFailures: 0 });
    } finally {
      f.restore();
    }
  });

  it("keeps a neighbouring window's busy times when Google answers with intervals past the asked window", async () => {
    const o = await owner("access-1");
    // B is the start of a window; a meeting runs across it and another follows right after.
    const B = (Math.floor(Date.now() / WINDOW_MS) + 2) * WINDOW_MS;
    const f = google({
      busy: () => [
        { start: iso(B - HOUR), end: iso(B + HOUR) },
        { start: iso(B + HOUR), end: iso(B + 2 * HOUR) },
      ],
    });
    try {
      // Window B is read first (a booking page a few days after B), then window A (a page a few days before B).
      await getExternalBusy({ userIds: [o.user.id], start: new Date(B + 4 * DAY), end: new Date(B + 5 * DAY) });
      await getExternalBusy({ userIds: [o.user.id], start: new Date(B - 5 * DAY), end: new Date(B - 4 * DAY) });
      expect(f.callsTo("/freeBusy", "POST")).toHaveLength(2);
      // Both windows are fresh now: the cache answers, and every minute of both meetings is still busy.
      const r = await getExternalBusy({ userIds: [o.user.id], start: new Date(B - 2 * HOUR), end: new Date(B + 3 * HOUR) });
      expect(f.callsTo("/freeBusy", "POST")).toHaveLength(2);
      const busy = r[o.user.id]!.busy.filter((b) => b.calendarId === o.work.id);
      const covered = (ms: number) => busy.some((b) => b.start.getTime() <= ms && b.end.getTime() > ms);
      for (let ms = B - HOUR; ms < B + 2 * HOUR; ms += 15 * 60_000) expect(covered(ms), iso(ms)).toBe(true);
      expect(covered(B + 2 * HOUR)).toBe(false);
      // Each window holds only its own part.
      for (const b of busy) expect(b.start.getTime() < B && b.end.getTime() > B).toBe(false);
    } finally {
      f.restore();
    }
  });
});
