// Host-side calendar changes on PGlite (SPEC CAL-14, CAL-13, CR-17; ARCHITECTURE 10.3): the sync job detects moved,
// deleted and declined provider events of upcoming meetings and calls lifecycle-core's applyExternalCalendarChange with
// the right change type; buffer events report their own moves; calendars without sync, canceled and past meetings are
// skipped; checks are spaced 10 minutes apart; failures leave the change for the next run. Google push notifications:
// channel verification, cache invalidation and an immediate sync job; channels are created, kept and stopped.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  changes: [] as { linkedEventId: string; change: { type: string; start?: Date; end?: Date } }[],
  fail: false,
}));

vi.mock("@/lib/lifecycle", () => ({
  applyExternalCalendarChange: async (p: { linkedEventId: string; change: { type: string } }) => {
    if (h.fail) throw Object.assign(new Error("This action is not available yet."), { code: "not_configured" });
    h.changes.push(p);
  },
}));
vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (connectionId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  encryptedTokenColumns: async () => ({}),
}));
vi.mock("@/lib/calendars/providers/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars/providers/registry")>();
  const { fakeCalendarProvider } = await import("../helpers/fake-providers");
  return { ...real, getProvider: (id: "google") => fakeCalendarProvider(id) };
});
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { calendarConnections, calendarLinkedEvents, calendars, calendarSyncWindows, calendarWatchChannels, jobs, scheduledEvents, users } = await import("@/db/schema");
const { upsertLinkedEvent } = await import("@/lib/calendars/linked-events");
const { syncBookedEvents, syncCalendar } = await import("@/lib/calendars/sync");
const { ensureWatchChannels, handleGooglePush } = await import("@/lib/calendars/watch");
const { hashToken } = await import("@/lib/crypto");
const { createBooking, createEventType } = await import("../factories");
const { fakeCalendarProvider, freezeTime, mockFetch, resetFakeProviders } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { setupGoogle, HOUR, MIN } = await import("./helpers");

const t = useTestDb();
const google = () => fakeCalendarProvider("google");

beforeEach(() => {
  resetFakeProviders();
  h.changes = [];
  h.fail = false;
});

async function booked(opts: { buffers?: boolean; syncChanges?: boolean; startInHours?: number } = {}) {
  const g = await setupGoogle(t.db, { calendars: [{ externalId: "me@example.com", isPrimary: true, checkConflicts: true, includeBuffers: opts.buffers ?? false }] });
  if (opts.syncChanges === false) await t.db.update(calendars).set({ syncChanges: false }).where(eq(calendars.id, g.calendarIds[0]!));
  await t.db.update(users).set({ destinationCalendarId: g.calendarIds[0] }).where(eq(users.id, g.user.id));
  const { eventType } = await createEventType(t.db, { owner: g.user, durationMinutes: 30, overrides: opts.buffers ? { bufferBeforeMinutes: 15, bufferAfterMinutes: 15 } : {} });
  const { scheduledEvent: se } = await createBooking(t.db, { eventType, start: new Date(Date.now() + (opts.startInHours ?? 48) * HOUR) });
  const r = await upsertLinkedEvent({
    userId: g.user.id,
    purpose: "meeting",
    scheduledEventId: se.id,
    event: { title: "Sam and Julian", descriptionText: "", start: se.startAt, end: se.endAt, attendees: [], sendInvitations: false, transparency: "busy", icalUid: se.icsUid },
  });
  // Written just now (checked at write time): make the rows due for the next sync run.
  await t.db.update(calendarLinkedEvents).set({ lastCheckedAt: null }).where(eq(calendarLinkedEvents.scheduledEventId, se.id));
  const events = () => google().events.get(`${g.connectionId}:me@example.com`)!;
  const providerEvent = (purpose = "meeting") => events().find((e) => e.extendedPrivate?.kairosPurpose === purpose)!;
  return { g, se, linkedEventId: r.linkedEventId, providerEvent, events };
}

const getCalls = () => google().calls.filter((c) => c.method === "getEvent").length;

describe("syncBookedEvents (CAL-14)", () => {
  it("reports a move to lifecycle-core and remembers the new times", async () => {
    const m = await booked();
    const ev = m.providerEvent();
    ev.start = new Date(ev.start.getTime() + HOUR);
    ev.end = new Date(ev.end.getTime() + HOUR);
    const r = await syncBookedEvents();
    expect(r.changes).toBe(1);
    expect(h.changes).toEqual([{ linkedEventId: m.linkedEventId, change: { type: "moved", start: ev.start, end: ev.end } }]);
    const [row] = await t.db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, m.linkedEventId));
    expect(row).toMatchObject({ syncedStartAt: ev.start, syncedEndAt: ev.end, status: "synced" });
    // Checked again only after 10 minutes.
    const before = getCalls();
    await syncBookedEvents();
    expect(getCalls()).toBe(before);
    const clock = freezeTime(Date.now() + 11 * MIN);
    try {
      await syncBookedEvents();
      expect(getCalls()).toBe(before + 1);
      expect(h.changes).toHaveLength(1); // unchanged since
    } finally {
      clock.restore();
    }
  });

  it("reports deleted and declined events", async () => {
    const deleted = await booked();
    google().events.set(`${deleted.g.connectionId}:me@example.com`, []);
    const declined = await booked();
    declined.providerEvent().selfDeclined = true;
    await syncBookedEvents();
    expect(h.changes).toEqual(
      expect.arrayContaining([
        { linkedEventId: deleted.linkedEventId, change: { type: "deleted" } },
        { linkedEventId: declined.linkedEventId, change: { type: "declined" } },
      ]),
    );
    const [row] = await t.db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, deleted.linkedEventId));
    expect(row?.status).toBe("deleted");
  });

  it("reports a moved buffer event as a change of that buffer (CAL-13)", async () => {
    const m = await booked({ buffers: true });
    const buffer = m.providerEvent("buffer_after");
    buffer.end = new Date(buffer.end.getTime() + 15 * MIN);
    await syncBookedEvents();
    const [bufferRow] = await t.db
      .select()
      .from(calendarLinkedEvents)
      .where(and(eq(calendarLinkedEvents.scheduledEventId, m.se.id), eq(calendarLinkedEvents.purpose, "buffer_after")));
    expect(h.changes).toEqual([{ linkedEventId: bufferRow!.id, change: { type: "moved", start: buffer.start, end: buffer.end } }]);
  });

  it("skips calendars without sync, canceled meetings and past meetings", async () => {
    const off = await booked({ syncChanges: false });
    const canceled = await booked();
    await t.db.update(scheduledEvents).set({ status: "canceled" }).where(eq(scheduledEvents.id, canceled.se.id));
    const past = await booked({ startInHours: -3 });
    for (const m of [off, canceled, past]) google().events.set(`${m.g.connectionId}:me@example.com`, []);
    const r = await syncBookedEvents();
    expect(r.checked).toBe(0);
    expect(h.changes).toEqual([]);
  });

  it("leaves the change for the next run when lifecycle-core fails, and survives provider outages", async () => {
    const m = await booked();
    google().events.set(`${m.g.connectionId}:me@example.com`, []);
    h.fail = true;
    await syncBookedEvents();
    let [row] = await t.db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, m.linkedEventId));
    expect(row?.status).toBe("synced");
    h.fail = false;
    await syncCalendar(m.g.calendarIds[0]!); // push path ignores the 10 minute spacing
    expect(h.changes).toEqual([{ linkedEventId: m.linkedEventId, change: { type: "deleted" } }]);
    [row] = await t.db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, m.linkedEventId));
    expect(row?.status).toBe("deleted");

    const n = await booked();
    google().failNext = { kind: "transient", count: 1 };
    await expect(syncBookedEvents()).resolves.toMatchObject({ changes: 0 });
    const [c] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.id, n.g.connectionId));
    expect(c?.consecutiveFailures).toBe(1);
  });
});

describe("Google push notifications", () => {
  const env = process.env as Record<string, string | undefined>;
  let f: ReturnType<typeof mockFetch> | null = null;
  afterEach(() => {
    env.APP_URL = "http://localhost:3000";
    f?.restore();
    f = null;
  });

  it("verifies the channel, marks the cache stale and enqueues an immediate sync", async () => {
    const m = await booked();
    await t.db.insert(calendarSyncWindows).values({ calendarId: m.g.calendarIds[0]!, windowStart: new Date(0), windowEnd: new Date(31 * 86_400_000), fetchedAt: new Date(), status: "ok" });
    await t.db.insert(calendarWatchChannels).values({ calendarId: m.g.calendarIds[0]!, provider: "google", channelId: "chan-1", resourceId: "res", tokenHash: hashToken("secret-token"), expiresAt: new Date(Date.now() + 86_400_000) });
    const headers = (token: string, state = "exists") => new Headers({ "x-goog-channel-id": "chan-1", "x-goog-channel-token": token, "x-goog-resource-state": state });
    expect((await handleGooglePush(headers("wrong"))).status).toBe(403);
    expect((await handleGooglePush(headers("secret-token", "sync"))).status).toBe(200);
    expect(await t.db.select().from(jobs).where(eq(jobs.type, "calendars.sync_calendar"))).toHaveLength(0);
    const ok = await handleGooglePush(headers("secret-token"));
    expect(ok.status).toBe(200);
    const [job] = await t.db.select().from(jobs).where(eq(jobs.type, "calendars.sync_calendar"));
    expect(job).toMatchObject({ id: ok.jobId, payload: { calendarId: m.g.calendarIds[0] } });
    const [w] = await t.db.select().from(calendarSyncWindows).where(eq(calendarSyncWindows.calendarId, m.g.calendarIds[0]!));
    expect(w!.fetchedAt.getTime()).toBeLessThan(Date.now() - 50 * MIN);
    expect((await handleGooglePush(new Headers({ "x-goog-channel-id": "unknown", "x-goog-resource-state": "exists" }))).status).toBe(200);
    expect((await handleGooglePush(new Headers())).status).toBe(400);
  });

  it("creates one channel per needed calendar on a public https URL and stops unneeded ones", async () => {
    env.APP_URL = "https://kairos.example.com";
    const g = await setupGoogle(t.db, { calendars: [{ externalId: "me@example.com", isPrimary: true, checkConflicts: true }, { externalId: "other@group.calendar.google.com", isPrimary: false, checkConflicts: false }] });
    let created = 0;
    const stops: unknown[] = [];
    f = mockFetch(
      { method: "POST", url: "https://www.googleapis.com/calendar/v3/calendars/me%40example.com/events/watch", handler: (req) => (created++, { id: (req.body as { id: string }).id, resourceId: "res-1", expiration: String(Date.now() + 7 * 86_400_000) }) },
      { method: "POST", url: "https://www.googleapis.com/calendar/v3/channels/stop", handler: (req) => (stops.push(req.body), new Response(null, { status: 204 })) },
    );
    expect(await ensureWatchChannels(g.connectionId)).toEqual({ created: 1, stopped: 0 });
    const [ch] = await t.db.select().from(calendarWatchChannels).where(eq(calendarWatchChannels.calendarId, g.calendarIds[0]!));
    expect(ch?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const body = f.calls[0]!.body as { address: string; token: string; type: string };
    expect(body.address).toBe("https://kairos.example.com/api/webhooks/calendars/google");
    expect(hashToken(body.token)).toBe(ch!.tokenHash);
    expect(await ensureWatchChannels(g.connectionId)).toEqual({ created: 0, stopped: 0 });
    await t.db.update(calendars).set({ checkConflicts: false }).where(eq(calendars.id, g.calendarIds[0]!));
    expect(await ensureWatchChannels(g.connectionId)).toEqual({ created: 0, stopped: 1 });
    expect(stops).toEqual([{ id: ch!.channelId, resourceId: "res-1" }]);
    expect(created).toBe(1);
  });

  it("does nothing on http or local URLs", async () => {
    const g = await setupGoogle(t.db);
    expect(await ensureWatchChannels(g.connectionId)).toEqual({ created: 0, stopped: 0 });
  });
});
