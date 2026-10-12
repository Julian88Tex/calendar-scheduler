// Busy cache on PGlite (SPEC CAL-06, CAL-07, CAL-10, CAL-18, CAL-22, SCH-11, SCH-12; ARCHITECTURE 10.3): fetch and
// cache per window, freshness (no second provider call within the TTL), stale fallback on failures and timeouts, NOCAL
// without data younger than 24 hours, broken connections never fetched, own events excluded, unchecked calendars
// ignored, two connections unioned, the real Google mapping end to end through mocked endpoints, cache-only imports.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ useFake: true, delayMs: 0 }));

vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (connectionId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  getConnectionContext: async (connectionId: string) => ({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  encryptedTokenColumns: async () => ({}),
}));
vi.mock("@/lib/calendars/providers/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars/providers/registry")>();
  const { fakeCalendarProvider } = await import("../helpers/fake-providers");
  return {
    ...real,
    getProvider: (id: "google") => {
      if (!h.useFake) return real.getProvider(id);
      const p = fakeCalendarProvider(id);
      if (!h.delayMs) return p;
      return { ...p, capabilities: p.capabilities, listEvents: async (...args: Parameters<typeof p.listEvents>) => (await new Promise((r) => setTimeout(r, h.delayMs)), p.listEvents(...args)) };
    },
  };
});
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { calendarConnections, calendarLinkedEvents, calendars, calendarSyncWindows, externalEvents } = await import("@/db/schema");
const { getExternalBusy, listExternalEvents, WINDOW_MS } = await import("@/lib/calendars/busy");
const { replaceImportedBusy, disconnectConnection, setConflictCalendars } = await import("@/lib/calendars/connections");
const { fakeCalendarProvider, mockFetch, resetFakeProviders } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { DAY, HOUR, setupGoogle } = await import("./helpers");

const t = useTestDb();
const google = () => fakeCalendarProvider("google");
const listCalls = () => google().calls.filter((c) => c.method === "listEvents");

/** A day well inside one 31-day window (so a range of a few hours needs exactly one window). */
function midWindow(): Date {
  const now = Date.now();
  const start = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  let at = start + 15 * DAY;
  if (at < now + 2 * DAY) at = start + WINDOW_MS + 15 * DAY;
  return new Date(Math.floor(at / DAY) * DAY);
}

beforeEach(() => {
  resetFakeProviders();
  h.useFake = true;
  h.delayMs = 0;
});

describe("getExternalBusy", () => {
  it("fetches once and serves the cache within the TTL (CAL-10)", async () => {
    const g = await setupGoogle(t.db);
    const day = midWindow();
    google().setEvents(g.connectionId, g.externalIds[0]!, [
      { externalId: "e1", start: new Date(day.getTime() + 15 * HOUR), end: new Date(day.getTime() + 16 * HOUR), title: "Dentist" },
      { externalId: "e2", start: new Date(day.getTime() + 18 * HOUR), end: new Date(day.getTime() + 19 * HOUR), busy: false, title: "Maybe lunch" },
    ]);
    const range = { start: new Date(day.getTime() + 8 * HOUR), end: new Date(day.getTime() + 20 * HOUR) };
    const first = await getExternalBusy({ userIds: [g.user.id], ...range, maxAgeSeconds: 180 });
    expect(first[g.user.id]).toMatchObject({ ok: true, stale: false, nocal: false });
    expect(first[g.user.id]!.busy.map((b) => [b.externalId, b.title, b.calendarId])).toEqual([["e1", "Dentist", g.calendarIds[0]]]);
    const fetched = listCalls().length;
    expect(fetched).toBeGreaterThan(0);
    const second = await getExternalBusy({ userIds: [g.user.id], ...range, maxAgeSeconds: 180 });
    expect(listCalls().length).toBe(fetched);
    expect(second[g.user.id]!.busy).toHaveLength(1);
    // A submission recheck (60 s) of data younger than 60 s also hits the cache.
    await getExternalBusy({ userIds: [g.user.id], ...range, maxAgeSeconds: 60 });
    expect(listCalls().length).toBe(fetched);
    // A zero TTL refetches.
    await getExternalBusy({ userIds: [g.user.id], ...range, maxAgeSeconds: 0 });
    expect(listCalls().length).toBeGreaterThan(fetched);
  });

  it("answers ok with no busy for users without calendars, and ignores invalid ids", async () => {
    const g = await setupGoogle(t.db, { calendars: [] });
    const r = await getExternalBusy({ userIds: [g.user.id, "not-a-uuid"], start: new Date(), end: new Date(Date.now() + DAY) });
    expect(r[g.user.id]).toEqual({ ok: true, stale: false, nocal: false, busy: [] });
    expect(r["not-a-uuid"]).toEqual({ ok: true, stale: false, nocal: false, busy: [] });
    expect(listCalls()).toHaveLength(0);
  });

  it("falls back to stale data on failure and reports NOCAL without data younger than 24 hours (SCH-11)", async () => {
    const g = await setupGoogle(t.db);
    const day = midWindow();
    google().setEvents(g.connectionId, g.externalIds[0]!, [{ externalId: "e1", start: new Date(day.getTime() + 10 * HOUR), end: new Date(day.getTime() + 11 * HOUR) }]);
    const range = { start: day, end: new Date(day.getTime() + DAY) };
    await getExternalBusy({ userIds: [g.user.id], ...range });
    google().failNext = { kind: "transient", count: 5 };
    const stale = await getExternalBusy({ userIds: [g.user.id], ...range, maxAgeSeconds: 0 });
    expect(stale[g.user.id]).toMatchObject({ ok: false, stale: true, nocal: false });
    expect(stale[g.user.id]!.busy).toHaveLength(1);
    const [conn] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.id, g.connectionId));
    expect(conn?.consecutiveFailures).toBeGreaterThan(0);
    // The cached windows are now older than 24 hours.
    await t.db.update(calendarSyncWindows).set({ fetchedAt: new Date(Date.now() - 25 * HOUR) }).where(eq(calendarSyncWindows.calendarId, g.calendarIds[0]!));
    google().failNext = { kind: "transient", count: 5 };
    const old = await getExternalBusy({ userIds: [g.user.id], ...range });
    expect(old[g.user.id]).toMatchObject({ ok: false, nocal: true });
  });

  it("marks a connection error after three failures in a row, and heals it on success (CAL-15)", async () => {
    const g = await setupGoogle(t.db);
    const range = { start: midWindow(), end: new Date(midWindow().getTime() + DAY) };
    for (let i = 0; i < 3; i++) {
      google().failNext = { kind: "transient", count: 10 };
      await getExternalBusy({ userIds: [g.user.id], ...range, maxAgeSeconds: 0 });
    }
    let [conn] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.id, g.connectionId));
    expect(conn?.status).toBe("error");
    google().failNext = null;
    const r = await getExternalBusy({ userIds: [g.user.id], ...range, maxAgeSeconds: 0 });
    expect(r[g.user.id]?.ok).toBe(true);
    [conn] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.id, g.connectionId));
    expect(conn).toMatchObject({ status: "active", consecutiveFailures: 0 });
  });

  it("never calls the provider for a connection that needs a reconnect", async () => {
    const g = await setupGoogle(t.db, { status: "needs_reauth" });
    const r = await getExternalBusy({ userIds: [g.user.id], start: midWindow(), end: new Date(midWindow().getTime() + DAY) });
    expect(listCalls()).toHaveLength(0);
    expect(r[g.user.id]).toMatchObject({ ok: false, nocal: true });
  });

  it("returns stale data instead of waiting past the timeout", async () => {
    const g = await setupGoogle(t.db);
    const day = midWindow();
    google().setEvents(g.connectionId, g.externalIds[0]!, [{ externalId: "e1", start: new Date(day.getTime() + 10 * HOUR), end: new Date(day.getTime() + 11 * HOUR) }]);
    const range = { start: day, end: new Date(day.getTime() + DAY) };
    await getExternalBusy({ userIds: [g.user.id], ...range });
    h.delayMs = 1_500;
    const started = Date.now();
    const r = await getExternalBusy({ userIds: [g.user.id], ...range, maxAgeSeconds: 0, timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(1_200);
    expect(r[g.user.id]).toMatchObject({ ok: false, stale: true, nocal: false });
    expect(r[g.user.id]!.busy).toHaveLength(1);
    await new Promise((res) => setTimeout(res, 1_700)); // let the background fetch finish
  });

  it("excludes the app's own events (CAL-18) by provider id, private property and late writes", async () => {
    const g = await setupGoogle(t.db);
    const day = midWindow();
    const [linked] = await t.db
      .insert(calendarLinkedEvents)
      .values({ userId: g.user.id, connectionId: g.connectionId, calendarId: g.calendarIds[0], purpose: "poll_hold", externalId: "ours-by-id", idempotencyKey: `k-${Date.now()}`, status: "synced" })
      .returning();
    const [linked2] = await t.db
      .insert(calendarLinkedEvents)
      .values({ userId: g.user.id, connectionId: g.connectionId, calendarId: g.calendarIds[0], purpose: "poll_hold", idempotencyKey: `k2-${Date.now()}`, status: "pending" })
      .returning();
    const at = (hh: number) => new Date(day.getTime() + hh * HOUR);
    google().setEvents(g.connectionId, g.externalIds[0]!, [
      { externalId: "ours-by-id", start: at(9), end: at(10) },
      { externalId: "ours-by-prop", start: at(11), end: at(12), extendedPrivate: { kairosLinkedEventId: linked2!.id } },
      { externalId: "late", start: at(13), end: at(14) },
      { externalId: "theirs", start: at(15), end: at(16) },
    ]);
    const range = { start: day, end: new Date(day.getTime() + DAY) };
    const r = await getExternalBusy({ userIds: [g.user.id], ...range });
    expect(r[g.user.id]!.busy.map((b) => b.externalId).sort()).toEqual(["late", "theirs"]);
    const own = await t.db.select().from(externalEvents).where(eq(externalEvents.isOwn, true));
    expect(own.map((e) => e.externalId).sort()).toEqual(["ours-by-id", "ours-by-prop"]);
    // An event written after the window was fetched is excluded right away (anti-join).
    await t.db.update(calendarLinkedEvents).set({ externalId: "late" }).where(eq(calendarLinkedEvents.id, linked2!.id));
    const r2 = await getExternalBusy({ userIds: [g.user.id], ...range });
    expect(r2[g.user.id]!.busy.map((b) => b.externalId)).toEqual(["theirs"]);
    expect(linked).toBeTruthy();
  });

  it("ignores unchecked calendars at once and unions two connections (CAL-06, CAL-07)", async () => {
    const g = await setupGoogle(t.db, {
      calendars: [
        { externalId: "primary@x.com", isPrimary: true, checkConflicts: true },
        { externalId: "team@group.calendar.google.com", isPrimary: false, checkConflicts: false },
      ],
    });
    const second = await setupGoogle(t.db, { user: g.user });
    const day = midWindow();
    const at = (hh: number) => new Date(day.getTime() + hh * HOUR);
    google().setEvents(g.connectionId, "primary@x.com", [{ externalId: "p1", start: at(9), end: at(10) }]);
    google().setEvents(g.connectionId, "team@group.calendar.google.com", [{ externalId: "t1", start: at(11), end: at(12) }]);
    google().setEvents(second.connectionId, second.externalIds[0]!, [{ externalId: "s1", start: at(9), end: at(11) }]);
    const range = { start: day, end: new Date(day.getTime() + DAY) };
    let r = await getExternalBusy({ userIds: [g.user.id], ...range });
    expect(r[g.user.id]!.busy.map((b) => b.externalId).sort()).toEqual(["p1", "s1"]);
    await setConflictCalendars({ user: g.user }, [
      { calendarId: g.calendarIds[1]!, checked: true },
      { calendarId: g.calendarIds[0]!, checked: false },
    ]);
    r = await getExternalBusy({ userIds: [g.user.id], ...range });
    expect(r[g.user.id]!.busy.map((b) => b.externalId).sort()).toEqual(["s1", "t1"]);
    // Disconnecting the second account frees its time (CAL-16).
    await disconnectConnection({ user: g.user }, second.connectionId);
    r = await getExternalBusy({ userIds: [g.user.id], ...range });
    expect(r[g.user.id]!.busy.map((b) => b.externalId)).toEqual(["t1"]);
  });

  it("maps real Google responses end to end (SCH-12): transparency, declined, working location, out of office, all-day", async () => {
    h.useFake = false;
    const g = await setupGoogle(t.db, { calendars: [{ externalId: "me@example.com", isPrimary: true, checkConflicts: true }] });
    const day = midWindow();
    const iso = (hh: number) => new Date(day.getTime() + hh * HOUR).toISOString();
    const date = day.toISOString().slice(0, 10);
    const next = new Date(day.getTime() + DAY).toISOString().slice(0, 10);
    const f = mockFetch({
      method: "GET",
      url: "https://www.googleapis.com/calendar/v3/calendars/me%40example.com/events",
      handler: () => ({
        items: [
          { id: "busy", summary: "Busy", start: { dateTime: iso(9) }, end: { dateTime: iso(10) } },
          { id: "free", summary: "Free", transparency: "transparent", start: { dateTime: iso(10) }, end: { dateTime: iso(11) } },
          { id: "declined", summary: "Declined", attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: iso(11) }, end: { dateTime: iso(12) } },
          { id: "tentative", summary: "Tentative", attendees: [{ self: true, responseStatus: "tentative" }], start: { dateTime: iso(12) }, end: { dateTime: iso(13) } },
          { id: "wl", eventType: "workingLocation", start: { date }, end: { date: next } },
          { id: "ooo", eventType: "outOfOffice", transparency: "transparent", start: { dateTime: iso(13) }, end: { dateTime: iso(14) } },
          { id: "allday", summary: "Offsite", start: { date }, end: { date: next } },
          { id: "rec_1", recurringEventId: "rec", summary: "Standup", start: { dateTime: iso(15) }, end: { dateTime: iso(15.25) } },
          { id: "cancelled", status: "cancelled", start: { dateTime: iso(16) }, end: { dateTime: iso(17) } },
        ],
      }),
    });
    try {
      const r = await getExternalBusy({ userIds: [g.user.id], start: day, end: new Date(day.getTime() + DAY) });
      const busy = r[g.user.id]!.busy;
      expect(busy.map((b) => b.externalId).sort()).toEqual(["allday", "busy", "ooo", "rec_1", "tentative"]);
      expect(busy.find((b) => b.externalId === "allday")).toMatchObject({ allDay: true, allDayStartDate: date, allDayEndDate: next });
      expect(f.calls[0]!.url.searchParams.getAll("eventTypes")).toEqual(["default", "focusTime", "outOfOffice", "fromGmail", "birthday"]);
    } finally {
      f.restore();
    }
  });
});

describe("listExternalEvents", () => {
  it("lists the caller's events with titles, calendar names and all-day events as local days", async () => {
    const g = await setupGoogle(t.db, { timezone: "America/Los_Angeles", calendars: [{ externalId: "me@example.com", name: "Personal", isPrimary: true, checkConflicts: true }] });
    const day = midWindow();
    const date = day.toISOString().slice(0, 10);
    google().setEvents(g.connectionId, "me@example.com", [
      { externalId: "x", start: new Date(day.getTime() + 18 * HOUR), end: new Date(day.getTime() + 19 * HOUR), title: "Yoga", busy: false },
      { externalId: "y", start: day, end: new Date(day.getTime() + DAY), allDay: true, allDayStartDate: date, allDayEndDate: new Date(day.getTime() + DAY).toISOString().slice(0, 10), title: "Holiday" },
    ]);
    const items = await listExternalEvents({ userId: g.user.id, start: day, end: new Date(day.getTime() + DAY + 12 * HOUR) });
    const holiday = items.find((i) => i.title === "Holiday");
    expect(holiday).toMatchObject({ calendarName: "Personal", allDay: true, busy: true });
    // Midnight to midnight in Los Angeles (7 or 8 hours after UTC midnight).
    expect([7, 8]).toContain((holiday!.start.getTime() - day.getTime()) / HOUR);
    expect(items.find((i) => i.title === "Yoga")).toMatchObject({ busy: false, allDay: false });
  });
});

describe("replaceImportedBusy (CAL-22)", () => {
  afterEach(() => vi.restoreAllMocks());
  it("creates one read-only connection whose events block slots without any provider call", async () => {
    const g = await setupGoogle(t.db, { calendars: [] });
    const day = midWindow();
    const ev = (id: string, hh: number) => ({ externalId: id, start: new Date(day.getTime() + hh * HOUR), end: new Date(day.getTime() + (hh + 1) * HOUR), title: `Imported ${id}` });
    const a = await replaceImportedBusy({ userId: g.user.id, source: "calendly", events: [ev("a", 9), ev("b", 10)] });
    const b = await replaceImportedBusy({ userId: g.user.id, source: "calendly", events: [ev("c", 11)] });
    expect(b.connectionId).toBe(a.connectionId);
    const conns = await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, g.user.id));
    expect(conns.filter((c) => c.provider === "calendly_import")).toHaveLength(1);
    const cals = await t.db.select().from(calendars).where(eq(calendars.connectionId, a.connectionId));
    expect(cals).toHaveLength(1);
    expect(cals[0]).toMatchObject({ canWrite: false, checkConflicts: true });
    const r = await getExternalBusy({ userIds: [g.user.id], start: day, end: new Date(day.getTime() + DAY), maxAgeSeconds: 0 });
    expect(r[g.user.id]!.busy.map((x) => x.externalId)).toEqual(["c"]);
    expect(r[g.user.id]!.ok).toBe(true);
    expect(google().calls).toHaveLength(0);
    await disconnectConnection({ user: g.user }, a.connectionId);
    const after = await getExternalBusy({ userIds: [g.user.id], start: day, end: new Date(day.getTime() + DAY) });
    expect(after[g.user.id]!.busy).toEqual([]);
  });
});
