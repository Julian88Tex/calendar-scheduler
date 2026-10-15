// Free/busy only calendars on PGlite (owner request; docs/SCOPE.md priority 3: a work calendar shared into the owner's
// Google account with "See only free/busy" must block booking times). Through a fake Google Calendar API (calendarList,
// events.list, FreeBusy, events.watch): the calendar list includes freeBusyReader calendars (busy only, never
// writable), the settings pickers show them with a "Free/busy only" note and keep them out of the calendar to add
// events to, the busy cache reads them with one batched FreeBusy request per window (cache, TTL and rechecks shared with
// event based calendars) and merges them into the same busy result as "Busy ({calendar name})", a FreeBusy failure
// keeps the readable calendars' fresh data, and push channels and change sync are for readable calendars only.
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockRequest } from "../helpers/fake-providers";

const sync = vi.hoisted(() => ({ changes: [] as unknown[] }));

vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (connectionId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  getConnectionContext: async (connectionId: string) => ({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  encryptedTokenColumns: async () => ({}),
}));
vi.mock("@/lib/lifecycle", () => ({
  applyExternalCalendarChange: async (p: unknown) => {
    sync.changes.push(p);
  },
}));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));
vi.mock("@/lib/calendars/actions", () => ({
  disconnectCalendar: async () => ({ ok: true, data: {} }),
  saveCalendarSyncSettings: async () => ({ ok: true }),
  saveConflictCalendars: async () => ({ ok: true }),
  saveDestinationCalendar: async () => ({ ok: true }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/app/availability/calendar-settings",
  useSearchParams: () => new URLSearchParams(),
}));

const { calendarConnections, calendarLinkedEvents, calendars, calendarSyncWindows, calendarWatchChannels } = await import("@/db/schema");
const { GOOGLE_FREE_BUSY_ONLY_TAG } = await import("@/lib/calendars/access");
const { getExternalBusy, WINDOW_MS } = await import("@/lib/calendars/busy");
const { setConflictCalendars, setDestinationCalendar, syncCalendarList } = await import("@/lib/calendars/connections");
const { getCalendarSettingsView } = await import("@/lib/calendars/settings");
const { syncBookedEvents } = await import("@/lib/calendars/sync");
const { ensureWatchChannels } = await import("@/lib/calendars/watch");
const { CalendarSettings } = await import("@/components/calendars/calendar-settings");
const { conflictCalendarNote, destinationChoices, FREE_BUSY_ONLY_NOTE } = await import("@/components/calendars/shared");
const { createBooking, createEventType } = await import("../factories");
const { mockFetch, mockResponse } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { DAY, HOUR, setupGoogle } = await import("./helpers");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const G = "https://www.googleapis.com/calendar/v3";
const ME = "me@example.com";
const WORK = "jjoseph@copado.com";
const CLIENT = "client-team@group.calendar.google.com";

/** A day well inside one 31-day window (a range of a few hours needs exactly one window). */
function midWindow(): Date {
  const now = Date.now();
  const start = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  let at = start + 15 * DAY;
  if (at < now + 2 * DAY) at = start + WINDOW_MS + 15 * DAY;
  return new Date(Math.floor(at / DAY) * DAY);
}

// ---------------------------------------------------------------------------------------------------------------
// Fake Google Calendar API

type FakeCal = { id: string; summary: string; accessRole: "owner" | "writer" | "reader" | "freeBusyReader"; primary?: boolean };
type Google = {
  calendarList: FakeCal[];
  /** events.list items per calendar (readable calendars). */
  events: Record<string, { id: string; summary?: string; start: string; end: string; transparency?: string }[]>;
  /** FreeBusy intervals per calendar. */
  busy: Record<string, { start: string; end: string }[]>;
  freeBusyFails: boolean;
  /** Per calendar FreeBusy errors ("internalError", "backendError"): that calendar alone is unreadable. */
  freeBusyErrors: Record<string, string>;
};

let g: Google;
let f: ReturnType<typeof mockFetch>;

function role(id: string): FakeCal["accessRole"] | null {
  return g.calendarList.find((c) => c.id === id)?.accessRole ?? null;
}

function routes() {
  return mockFetch(
    { method: "GET", url: `${G}/users/me/calendarList`, handler: () => ({ items: g.calendarList }) },
    {
      method: "POST",
      url: `${G}/freeBusy`,
      handler: (req: MockRequest) => {
        if (g.freeBusyFails) return mockResponse({ error: { code: 503, message: "Backend Error" } }, { status: 503 });
        const body = req.body as { timeMin: string; timeMax: string; items: { id: string }[] };
        const calendarsOut: Record<string, unknown> = {};
        for (const { id } of body.items) {
          if (!role(id)) {
            calendarsOut[id] = { errors: [{ domain: "global", reason: "notFound" }], busy: [] };
            continue;
          }
          if (g.freeBusyErrors[id]) {
            calendarsOut[id] = { errors: [{ domain: "global", reason: g.freeBusyErrors[id] }], busy: [] };
            continue;
          }
          calendarsOut[id] = { busy: (g.busy[id] ?? []).filter((b) => b.start < body.timeMax && b.end > body.timeMin) };
        }
        return { kind: "calendar#freeBusy", timeMin: body.timeMin, timeMax: body.timeMax, calendars: calendarsOut };
      },
    },
    {
      method: "POST",
      url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/([^/]+)/events/watch`),
      handler: (req: MockRequest) => ({ id: (req.body as { id: string }).id, resourceId: `res-${req.params[0]}`, expiration: String(Date.now() + 7 * DAY) }),
    },
    {
      method: "GET",
      url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/([^/]+)/events(?:\\?|$)`),
      handler: (req: MockRequest) => {
        const id = decodeURIComponent(req.params[0]!);
        // Google refuses event details of a calendar shared as free/busy only.
        if (role(id) === "freeBusyReader") {
          return mockResponse({ error: { code: 403, message: "You need to have reader access to this calendar.", errors: [{ reason: "requiredAccessLevel" }] } }, { status: 403 });
        }
        return { items: (g.events[id] ?? []).map((e) => ({ status: "confirmed", ...e, start: { dateTime: e.start }, end: { dateTime: e.end } })) };
      },
    },
  );
}

const eventsListCalls = (id?: string) => f.calls.filter((c) => c.method === "GET" && /\/events$/.test(c.url.pathname) && (!id || c.url.pathname.includes(encodeURIComponent(id))));
const freeBusyCalls = () => f.calls.filter((c) => c.url.pathname.endsWith("/freeBusy"));

beforeEach(() => {
  g = {
    calendarList: [
      { id: ME, summary: ME, accessRole: "owner", primary: true },
      { id: WORK, summary: WORK, accessRole: "freeBusyReader" },
    ],
    events: {},
    busy: {},
    freeBusyFails: false,
    freeBusyErrors: {},
  };
  sync.changes = [];
  f = routes();
});
afterEach(() => {
  f.restore();
  env.APP_URL = "http://localhost:3000";
});

/** A Google connection whose calendar list came from the fake API (the work calendar listed busy only). */
async function connected() {
  const s = await setupGoogle(t.db, { calendars: [{ externalId: ME, name: ME, isPrimary: true, canWrite: true, checkConflicts: true }] });
  await syncCalendarList(s.connectionId);
  const rows = await t.db.select().from(calendars).where(eq(calendars.connectionId, s.connectionId));
  const byExt = new Map(rows.map((r) => [r.externalId, r]));
  return { ...s, actor: { user: s.user }, me: byExt.get(ME)!, work: byExt.get(WORK)!, rows };
}

/** Marks a calendar of the connection as checked and free/busy only (the work calendar, a client's team calendar). */
async function busyOnlyCalendar(connectionId: string, userId: string, externalId: string, name: string) {
  const [row] = await t.db
    .insert(calendars)
    .values({ connectionId, userId, externalId, name, isPrimary: false, canWrite: false, checkConflicts: true, ctag: GOOGLE_FREE_BUSY_ONLY_TAG })
    .returning();
  return row!;
}

// ---------------------------------------------------------------------------------------------------------------

describe("calendar list", () => {
  it("lists calendars shared as free/busy only: unchecked at first, busy only, never writable", async () => {
    const c = await connected();
    expect(f.calls[0]!.url.searchParams.get("minAccessRole")).toBe("freeBusyReader");
    expect(c.work).toMatchObject({ name: WORK, canWrite: false, checkConflicts: false, deletedAt: null });
    const view = await getCalendarSettingsView(c.user.id);
    const cals = view.connections[0]!.calendars;
    expect(cals.map((x) => [x.name, x.canWrite, x.busyOnly])).toEqual([
      [ME, true, false],
      [WORK, false, true],
    ]);
  });

  it("follows access changes between readable and free/busy only and marks the cached windows stale", async () => {
    const c = await connected();
    await setConflictCalendars(c.actor, [{ calendarId: c.work.id, checked: true }]);
    const day = midWindow();
    await getExternalBusy({ userIds: [c.user.id], start: day, end: new Date(day.getTime() + DAY) });
    const fresh = await t.db.select().from(calendarSyncWindows).where(eq(calendarSyncWindows.calendarId, c.work.id));
    expect(fresh.length).toBeGreaterThan(0);
    g.calendarList = g.calendarList.map((x) => (x.id === WORK ? { ...x, accessRole: "reader" as const } : x));
    await syncCalendarList(c.connectionId);
    expect((await getCalendarSettingsView(c.user.id)).connections[0]!.calendars.find((x) => x.name === WORK)?.busyOnly).toBe(false);
    const after = await t.db.select().from(calendarSyncWindows).where(eq(calendarSyncWindows.calendarId, c.work.id));
    for (const w of after) expect(w.fetchedAt.getTime()).toBeLessThan(Date.now() - 30 * 60_000);
    // Checked stays checked across the change.
    expect((await t.db.select().from(calendars).where(eq(calendars.id, c.work.id)))[0]?.checkConflicts).toBe(true);
  });
});

describe("settings pickers", () => {
  it("shows free/busy only calendars in the conflict picker with a note and keeps them out of the destination picker", async () => {
    const c = await connected();
    await setConflictCalendars(c.actor, [{ calendarId: c.work.id, checked: true }]);
    const view = await getCalendarSettingsView(c.user.id);
    const work = view.connections[0]!.calendars.find((x) => x.name === WORK)!;
    expect(conflictCalendarNote(work)).toBe(FREE_BUSY_ONLY_NOTE);
    expect(conflictCalendarNote(view.connections[0]!.calendars.find((x) => x.name === ME)!)).toBe("Primary calendar");
    expect(destinationChoices(view.connections).flatMap((x) => x.cals.map((cal) => cal.name))).toEqual([ME]);
    // The Configuration card lists the checked work calendar with its note.
    const html = renderToStaticMarkup(createElement(CalendarSettings, { view, appName: "Kairos", isAdmin: false }));
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain(`${WORK} ${FREE_BUSY_ONLY_NOTE}`);
    expect(text).toContain("Checking 2 of 2 calendars");
  });

  it("refuses a free/busy only calendar as the calendar to add events to", async () => {
    const c = await connected();
    await expect(setDestinationCalendar(c.actor, c.work.id)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("busy layer", () => {
  it("merges FreeBusy intervals of free/busy only calendars with event based ones, batched and cached", async () => {
    const c = await connected();
    await setConflictCalendars(c.actor, [{ calendarId: c.work.id, checked: true }]);
    const client = await busyOnlyCalendar(c.connectionId, c.user.id, CLIENT, "Client team");
    g.calendarList.push({ id: CLIENT, summary: "Client team", accessRole: "freeBusyReader" });
    const day = midWindow();
    const iso = (hh: number) => new Date(day.getTime() + hh * HOUR).toISOString();
    g.events[ME] = [{ id: "dentist", summary: "Dentist", start: iso(15), end: iso(16) }];
    g.busy[WORK] = [
      { start: iso(17), end: iso(18) },
      { start: iso(17.5), end: iso(19) },
    ];
    g.busy[CLIENT] = [{ start: iso(20), end: iso(21) }];
    const range = { start: new Date(day.getTime() + 8 * HOUR), end: new Date(day.getTime() + 22 * HOUR) };

    const first = await getExternalBusy({ userIds: [c.user.id], ...range, maxAgeSeconds: 180 });
    expect(first[c.user.id]).toMatchObject({ ok: true, stale: false, nocal: false });
    const busy = first[c.user.id]!.busy.map((b) => [b.title, b.calendarId, b.start.toISOString(), b.end.toISOString(), b.allDay]);
    expect(busy).toEqual([
      ["Dentist", c.me.id, iso(15), iso(16), false],
      [`Busy (${WORK})`, c.work.id, iso(17), iso(19), false],
      ["Busy (Client team)", client.id, iso(20), iso(21), false],
    ]);
    // One FreeBusy request per window for both free/busy only calendars; events.list only for the readable one.
    const windows = freeBusyCalls().length;
    expect(windows).toBeGreaterThan(0);
    for (const call of freeBusyCalls()) {
      expect((call.body as { items: { id: string }[] }).items.map((i) => i.id).sort()).toEqual([CLIENT, WORK]);
      expect((call.body as { timeZone: string }).timeZone).toBe("UTC");
    }
    expect(eventsListCalls(WORK)).toHaveLength(0);
    expect(eventsListCalls(ME)).toHaveLength(windows);

    // Within the TTL the cache answers; a submission recheck of older data asks Google again.
    await getExternalBusy({ userIds: [c.user.id], ...range, maxAgeSeconds: 180 });
    expect(freeBusyCalls()).toHaveLength(windows);
    g.busy[WORK] = [{ start: iso(9), end: iso(10) }];
    const recheck = await getExternalBusy({ userIds: [c.user.id], ...range, maxAgeSeconds: 0 });
    expect(freeBusyCalls().length).toBeGreaterThan(windows);
    expect(recheck[c.user.id]!.busy.filter((b) => b.calendarId === c.work.id).map((b) => b.start.toISOString())).toEqual([iso(9)]);
  });

  it("keeps the readable calendars' fresh data when FreeBusy fails, with the free/busy only calendar on stale data", async () => {
    const c = await connected();
    await setConflictCalendars(c.actor, [{ calendarId: c.work.id, checked: true }]);
    const day = midWindow();
    const iso = (hh: number) => new Date(day.getTime() + hh * HOUR).toISOString();
    g.events[ME] = [{ id: "dentist", summary: "Dentist", start: iso(15), end: iso(16) }];
    g.busy[WORK] = [{ start: iso(17), end: iso(18) }];
    const range = { start: new Date(day.getTime() + 8 * HOUR), end: new Date(day.getTime() + 22 * HOUR) };
    await getExternalBusy({ userIds: [c.user.id], ...range });

    g.freeBusyFails = true;
    g.events[ME] = [{ id: "lunch", summary: "Lunch", start: iso(12), end: iso(13) }];
    const r = await getExternalBusy({ userIds: [c.user.id], ...range, maxAgeSeconds: 0 });
    expect(r[c.user.id]).toMatchObject({ ok: false, stale: true, nocal: false });
    expect(r[c.user.id]!.busy.map((b) => b.title)).toEqual(["Lunch", `Busy (${WORK})`]);
  });

  it("treats a failing free/busy only calendar as its own failure: the connection stays healthy, the others refresh", async () => {
    const c = await connected();
    await setConflictCalendars(c.actor, [{ calendarId: c.work.id, checked: true }]);
    const client = await busyOnlyCalendar(c.connectionId, c.user.id, CLIENT, "Client team");
    g.calendarList.push({ id: CLIENT, summary: "Client team", accessRole: "freeBusyReader" });
    const day = midWindow();
    const iso = (hh: number) => new Date(day.getTime() + hh * HOUR).toISOString();
    g.events[ME] = [{ id: "dentist", summary: "Dentist", start: iso(15), end: iso(16) }];
    g.busy[WORK] = [{ start: iso(17), end: iso(18) }];
    g.busy[CLIENT] = [{ start: iso(20), end: iso(21) }];
    const range = { start: new Date(day.getTime() + 8 * HOUR), end: new Date(day.getTime() + 22 * HOUR) };
    expect((await getExternalBusy({ userIds: [c.user.id], ...range }))[c.user.id]).toMatchObject({ ok: true });
    const [before] = await t.db.select().from(calendarSyncWindows).where(eq(calendarSyncWindows.calendarId, c.work.id));

    // Google keeps failing on the work calendar alone (in the same batched request as the client's), then on the whole
    // FreeBusy request: more often than the connection failure threshold, while the other calendars keep changing.
    const titles = (r: Awaited<ReturnType<typeof getExternalBusy>>) => r[c.user.id]!.busy.map((b) => [b.title, b.start.toISOString()]);
    for (const [n, fail] of (["internalError", "backendError", "internalError", "backendError", "whole request"] as const).entries()) {
      if (fail === "whole request") g.freeBusyFails = true;
      else g.freeBusyErrors[WORK] = fail;
      g.events[ME] = [{ id: `lunch-${n}`, summary: `Lunch ${n}`, start: iso(12), end: iso(13) }];
      g.busy[CLIENT] = fail === "whole request" ? g.busy[CLIENT]! : [{ start: iso(9 + n), end: iso(9.5 + n) }];
      const r = await getExternalBusy({ userIds: [c.user.id], ...range, maxAgeSeconds: 0 });
      // The work calendar is on its last data (stale, never "No times available" while that data is under 24 hours old).
      expect(r[c.user.id]).toMatchObject({ ok: false, stale: true, nocal: false });
      const clientAt = fail === "whole request" ? iso(12) : iso(9 + n);
      expect(titles(r)).toEqual(
        [
          [`Lunch ${n}`, iso(12)],
          [`Busy (${WORK})`, iso(17)],
          ["Busy (Client team)", clientAt],
        ].sort((a, b) => a[1]!.localeCompare(b[1]!)),
      );
      const [conn] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.id, c.connectionId));
      expect(conn).toMatchObject({ status: "active", consecutiveFailures: 0, lastError: null });
      // The work window is not refreshed and not left leased: the next read asks Google again.
      const [w] = await t.db.select().from(calendarSyncWindows).where(eq(calendarSyncWindows.calendarId, c.work.id));
      expect(w).toMatchObject({ status: "ok", fetchLeaseUntil: null, fetchLeaseHolder: null });
      expect(w!.fetchedAt.getTime()).toBe(before!.fetchedAt.getTime());
      expect(w!.error).toMatch(/free\/busy times|Backend Error|503/i);
    }
    const [client1] = await t.db.select().from(calendarSyncWindows).where(eq(calendarSyncWindows.calendarId, client.id));
    expect(client1!.fetchedAt.getTime()).toBeGreaterThan(before!.fetchedAt.getTime());

    // Google answers again: the work calendar refreshes on the next read.
    g.freeBusyFails = false;
    g.freeBusyErrors = {};
    g.busy[WORK] = [{ start: iso(18), end: iso(19) }];
    const calls = freeBusyCalls().length;
    const healed = await getExternalBusy({ userIds: [c.user.id], ...range });
    expect(freeBusyCalls().length).toBeGreaterThan(calls);
    expect(healed[c.user.id]).toMatchObject({ ok: true, stale: false, nocal: false });
    expect(healed[c.user.id]!.busy.filter((b) => b.calendarId === c.work.id).map((b) => b.start.toISOString())).toEqual([iso(18)]);
  });

  it("leaves out a free/busy only calendar that was unshared (notFound) and refreshes the calendar list", async () => {
    const c = await connected();
    await setConflictCalendars(c.actor, [{ calendarId: c.work.id, checked: true }]);
    g.calendarList = g.calendarList.filter((x) => x.id !== WORK);
    const day = midWindow();
    const r = await getExternalBusy({ userIds: [c.user.id], start: day, end: new Date(day.getTime() + DAY) });
    expect(r[c.user.id]).toMatchObject({ ok: true, busy: [] });
    const { jobs } = await import("@/db/schema");
    const queued = await t.db.select().from(jobs).where(eq(jobs.type, "calendars.refresh_calendar_list"));
    expect(queued.some((j) => (j.payload as { connectionId?: string }).connectionId === c.connectionId)).toBe(true);
  });
});

describe("push channels and change sync", () => {
  it("opens push channels for readable calendars only", async () => {
    env.APP_URL = "https://kairos.example.com";
    const c = await connected();
    await setConflictCalendars(c.actor, [{ calendarId: c.work.id, checked: true }]);
    expect(await ensureWatchChannels(c.connectionId)).toEqual({ created: 1, stopped: 0 });
    const watched = await t.db.select().from(calendarWatchChannels);
    expect(watched.map((w) => w.calendarId)).toEqual([c.me.id]);
    expect(f.calls.filter((x) => x.url.pathname.endsWith("/events/watch")).map((x) => decodeURIComponent(x.url.pathname))).toEqual([`/calendar/v3/calendars/${ME}/events/watch`]);
  });

  it("never checks booked events on a free/busy only calendar for host-side changes", async () => {
    const c = await connected();
    const { eventType } = await createEventType(t.db, { owner: c.user, durationMinutes: 30 });
    const { scheduledEvent } = await createBooking(t.db, { eventType, start: new Date(Date.now() + 2 * DAY) });
    // A meeting written while the work calendar was still writable (its access dropped to free/busy since).
    await t.db.insert(calendarLinkedEvents).values({
      userId: c.user.id,
      connectionId: c.connectionId,
      calendarId: c.work.id,
      purpose: "meeting",
      scheduledEventId: scheduledEvent.id,
      externalId: "evt-on-work",
      syncedStartAt: scheduledEvent.startAt,
      syncedEndAt: scheduledEvent.endAt,
      status: "synced",
      idempotencyKey: `test-${scheduledEvent.id}`,
    });
    const before = f.calls.length;
    expect(await syncBookedEvents()).toEqual({ checked: 0, changes: 0 });
    expect(f.calls.length).toBe(before);
    expect(sync.changes).toEqual([]);
  });
});
