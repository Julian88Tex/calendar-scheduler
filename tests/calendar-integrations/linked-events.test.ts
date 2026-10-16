// Linked events on PGlite (SPEC CAL-11, CAL-12, CAL-13, CAL-20, VID-07): exactly one provider event per booking even
// when retried after a timeout, calendar invitation and email confirmation payloads, Meet link, iCal UID and event
// link returned, one event per group slot (created once, then patched), buffer events, recreation after a host-side
// delete, deletes with retries, re-pointing after a reschedule, skipped without a destination.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ useFake: false }));

vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (connectionId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  encryptedTokenColumns: async () => ({}),
}));
vi.mock("@/lib/calendars/providers/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars/providers/registry")>();
  const { fakeCalendarProvider } = await import("../helpers/fake-providers");
  return { ...real, getProvider: (id: "google") => (h.useFake ? fakeCalendarProvider(id) : real.getProvider(id)) };
});
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { calendarLinkedEvents, calendars, eventTypes, jobs, users } = await import("@/db/schema");
const { upsertLinkedEvent, deleteLinkedEvent, repointLinkedEvents, providerEventIdFor } = await import("@/lib/calendars/linked-events");
const { googleTiming } = await import("@/lib/calendars/providers/google");
const { createBooking, createEventType } = await import("../factories");
const { fakeCalendarProvider, mockFetch, mockResponse, resetFakeProviders } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { setupGoogle } = await import("./helpers");

const t = useTestDb();
const G = "https://www.googleapis.com/calendar/v3";

beforeEach(() => {
  resetFakeProviders();
  h.useFake = false;
  googleTiming.meetPollDelaysMs = [0, 0, 0];
});

async function meeting(opts: { buffers?: [number, number]; includeBuffers?: boolean } = {}) {
  const g = await setupGoogle(t.db, { calendars: [{ externalId: "me@example.com", isPrimary: true, checkConflicts: true, includeBuffers: opts.includeBuffers ?? false }] });
  await t.db.update(users).set({ destinationCalendarId: g.calendarIds[0] }).where(eq(users.id, g.user.id));
  const { eventType } = await createEventType(t.db, {
    owner: g.user,
    durationMinutes: 30,
    overrides: { bufferBeforeMinutes: opts.buffers?.[0] ?? 0, bufferAfterMinutes: opts.buffers?.[1] ?? 0 },
  });
  const { scheduledEvent } = await createBooking(t.db, { eventType, start: new Date(Date.now() + 3 * 86_400_000) });
  return { g, eventType, scheduledEvent };
}

const event = (se: { startAt: Date; endAt: Date; icsUid: string }, over: Record<string, unknown> = {}) => ({
  title: "Sam Lee and Julian",
  descriptionText: "Event Name: 30 Minute Virtual\n\nNeed to make changes to this event?",
  location: null,
  start: se.startAt,
  end: se.endAt,
  attendees: [{ email: "sam@example.com", name: "Sam Lee" }],
  sendInvitations: true,
  conference: "google_meet" as const,
  transparency: "busy" as const,
  icalUid: se.icsUid,
  ...over,
});

describe("upsertLinkedEvent", () => {
  it("creates exactly one Google event when retried after a timeout, with attendees, sendUpdates=all and Meet", async () => {
    const { g, scheduledEvent: se } = await meeting();
    const store = new Map<string, Record<string, unknown>>();
    let inserts = 0;
    const f = mockFetch(
      {
        method: "POST",
        url: `${G}/calendars/me%40example.com/events`,
        handler: (req) => {
          inserts++;
          const body = req.body as Record<string, unknown>;
          const id = body.id as string;
          if (store.has(id)) return mockResponse({ error: { code: 409, message: "The requested identifier already exists.", errors: [{ reason: "duplicate" }] } }, { status: 409 });
          const ev = { ...body, status: "confirmed", iCalUID: `${id}@google.com`, htmlLink: `https://www.google.com/calendar/event?eid=${id}`, hangoutLink: "https://meet.google.com/abc-defg-hij", etag: '"1"' };
          store.set(id, ev);
          // The first attempt succeeds at Google but times out for us.
          if (inserts === 1) return mockResponse({ error: { code: 503, message: "Backend Error" } }, { status: 503 });
          return ev;
        },
      },
      { method: "GET", url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/me%40example\\.com/events/([^/?]+)`), handler: (req) => store.get(req.params[0]!) ?? mockResponse({ error: { code: 404 } }, { status: 404 }) },
    );
    try {
      const first = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se) });
      expect(first.status).toBe("pending");
      const second = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se) });
      expect(second).toMatchObject({
        status: "synced",
        linkedEventId: first.linkedEventId,
        externalId: providerEventIdFor(first.linkedEventId),
        icalUid: `${providerEventIdFor(first.linkedEventId)}@google.com`,
        htmlLink: `https://www.google.com/calendar/event?eid=${providerEventIdFor(first.linkedEventId)}`,
        conference: { joinUrl: "https://meet.google.com/abc-defg-hij", status: "pushed" },
      });
      expect(store.size).toBe(1);
      const post = f.callsTo("/events", "POST")[0]!;
      expect(post.url.searchParams.get("sendUpdates")).toBe("all");
      expect(post.url.searchParams.get("conferenceDataVersion")).toBe("1");
      const body = post.body as { attendees: { email: string }[]; extendedProperties: { private: Record<string, string> } };
      expect(body.attendees).toEqual([{ email: "sam@example.com", displayName: "Sam Lee" }]);
      expect(body.extendedProperties.private).toEqual({ kairosEventId: se.id, kairosPurpose: "meeting", kairosLinkedEventId: first.linkedEventId });
      const rows = await t.db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.scheduledEventId, se.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "synced", externalId: second.externalId, syncedStartAt: se.startAt, syncedEndAt: se.endAt });
    } finally {
      f.restore();
    }
  });

  it("email confirmation mode writes no attendees with sendUpdates=none", async () => {
    const { g, scheduledEvent: se } = await meeting();
    let body: Record<string, unknown> = {};
    const f = mockFetch({ method: "POST", url: `${G}/calendars/`, handler: (req) => ((body = req.body as Record<string, unknown>), { ...body, iCalUID: "x@google.com" }) });
    try {
      const r = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se, { sendInvitations: false, conference: null }) });
      expect(r.status).toBe("synced");
      expect(f.calls[0]!.url.searchParams.get("sendUpdates")).toBe("none");
      expect(body.attendees).toEqual([]);
    } finally {
      f.restore();
    }
  });

  it("updates one provider event per group slot (created once, patched on every join)", async () => {
    h.useFake = true;
    const { g, scheduledEvent: se } = await meeting();
    const slot = (n: number) => event(se, { attendees: [], sendInvitations: false, conference: null, descriptionText: `${n} of 3 spots filled` });
    const a = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: slot(1) });
    const b = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, existingLinkedEventId: a.linkedEventId, event: slot(2) });
    const c = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: slot(3) });
    expect(new Set([a.linkedEventId, b.linkedEventId, c.linkedEventId]).size).toBe(1);
    const calls = fakeCalendarProvider("google").calls;
    expect(calls.filter((x) => x.method === "createEvent")).toHaveLength(1);
    expect(calls.filter((x) => x.method === "updateEvent")).toHaveLength(2);
    const lastInput = calls.at(-1)!.args[2] as { attendees: unknown[]; descriptionText: string };
    expect(lastInput.attendees).toEqual([]);
    expect(lastInput.descriptionText).toBe("3 of 3 spots filled");
  });

  it("writes buffer events when the calendar includes buffers (CAL-13: 15/15 buffers -> 3 events)", async () => {
    h.useFake = true;
    const { g, scheduledEvent: se } = await meeting({ buffers: [15, 15], includeBuffers: true });
    await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se) });
    const creates = fakeCalendarProvider("google").calls.filter((x) => x.method === "createEvent");
    expect(creates).toHaveLength(3);
    const titles = creates.map((c) => (c.args[1] as { title: string }).title).sort();
    expect(titles).toEqual(["Buffer: Sam Lee and Julian", "Buffer: Sam Lee and Julian", "Sam Lee and Julian"]);
    const before = creates.find((c) => (c.args[1] as { privateProperties: Record<string, string> }).privateProperties.kairosPurpose === "buffer_before")!.args[1] as { start: Date; end: Date; attendees: unknown[] };
    expect(before.end).toEqual(se.startAt);
    expect(before.start).toEqual(new Date(se.startAt.getTime() - 15 * 60_000));
    expect(before.attendees).toEqual([]);
    // Turning the setting off removes them on the next write.
    await t.db.update(calendars).set({ includeBuffers: false }).where(eq(calendars.id, g.calendarIds[0]!));
    await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se) });
    const rows = await t.db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.scheduledEventId, se.id));
    expect(rows.filter((r) => r.purpose !== "meeting").every((r) => r.status === "deleted")).toBe(true);
    // Without the setting a meeting writes one event.
    const other = await meeting({ buffers: [15, 15], includeBuffers: false });
    resetFakeProviders();
    await upsertLinkedEvent({ userId: other.g.user.id, purpose: "meeting", scheduledEventId: other.scheduledEvent.id, event: event(other.scheduledEvent) });
    expect(fakeCalendarProvider("google").calls.filter((x) => x.method === "createEvent")).toHaveLength(1);
  });

  it("recreates the event under a new id when the host deleted it meanwhile", async () => {
    const { g, scheduledEvent: se } = await meeting();
    const ids: string[] = [];
    const f = mockFetch(
      { method: "POST", url: `${G}/calendars/`, handler: (req) => (ids.push((req.body as { id: string }).id), { ...(req.body as object), iCalUID: "u@google.com" }) },
      { method: "PATCH", url: `${G}/calendars/`, handler: () => mockResponse({ error: { code: 404, message: "Not Found" } }, { status: 404 }) },
    );
    try {
      const a = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se, { conference: null }) });
      const b = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, existingLinkedEventId: a.linkedEventId, event: event(se, { conference: null, title: "Moved" }) });
      expect(b.status).toBe("synced");
      expect(ids).toHaveLength(2);
      expect(ids[1]).not.toBe(ids[0]);
      expect(ids[1]).toBe(providerEventIdFor(a.linkedEventId, ids[0]));
      expect(ids[1]).toMatch(/^[0-9a-v]{32}$/);
    } finally {
      f.restore();
    }
  });

  it("skips without a destination and uses the event type override (CAL-20)", async () => {
    h.useFake = true;
    const { g, eventType, scheduledEvent: se } = await meeting();
    await t.db.update(users).set({ destinationCalendarId: null }).where(eq(users.id, g.user.id));
    const skipped = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se) });
    expect(skipped).toMatchObject({ status: "skipped_no_calendar", linkedEventId: "", externalId: null });
    await t.db.update(eventTypes).set({ destinationCalendarId: g.calendarIds[0] }).where(eq(eventTypes.id, eventType.id));
    const written = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se) });
    expect(written.status).toBe("synced");
  });

  it("refuses another user's calendar and another user's linked event", async () => {
    h.useFake = true;
    const a = await meeting();
    const b = await meeting();
    await expect(
      upsertLinkedEvent({ userId: a.g.user.id, purpose: "meeting", scheduledEventId: a.scheduledEvent.id, calendarId: b.g.calendarIds[0], event: event(a.scheduledEvent) }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const own = await upsertLinkedEvent({ userId: b.g.user.id, purpose: "meeting", scheduledEventId: b.scheduledEvent.id, event: event(b.scheduledEvent) });
    await expect(
      upsertLinkedEvent({ userId: a.g.user.id, purpose: "meeting", scheduledEventId: a.scheduledEvent.id, existingLinkedEventId: own.linkedEventId, event: event(a.scheduledEvent) }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("deleteLinkedEvent and repointLinkedEvents", () => {
  it("deletes the meeting and its buffer events, notifying attendees only for the meeting", async () => {
    h.useFake = true;
    const { g, scheduledEvent: se } = await meeting({ buffers: [10, 10], includeBuffers: true });
    const r = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se) });
    await deleteLinkedEvent({ linkedEventId: r.linkedEventId, notifyAttendees: true });
    const deletes = fakeCalendarProvider("google").calls.filter((x) => x.method === "deleteEvent");
    expect(deletes).toHaveLength(3);
    expect(deletes.filter((d) => (d.args[2] as { notifyAttendees: boolean }).notifyAttendees)).toHaveLength(1);
    const rows = await t.db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.scheduledEventId, se.id));
    expect(rows.every((x) => x.status === "deleted")).toBe(true);
  });

  it("retries a delete that failed transiently", async () => {
    h.useFake = true;
    const { g, scheduledEvent: se } = await meeting();
    const r = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se) });
    fakeCalendarProvider("google").failNext = { kind: "transient", count: 1 };
    await deleteLinkedEvent({ linkedEventId: r.linkedEventId, notifyAttendees: false });
    const [retry] = await t.db.select().from(jobs).where(and(eq(jobs.type, "calendars.linked_event_retry"), eq(jobs.idempotencyKey, `delete:${r.linkedEventId}`)));
    expect(retry?.payload).toMatchObject({ op: "delete", linkedEventId: r.linkedEventId });
    const [row] = await t.db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, r.linkedEventId));
    expect(row?.status).toBe("synced");
  });

  it("deletes the event a timed out create left at Google, so canceling first leaves no orphan", async () => {
    const { g, scheduledEvent: se } = await meeting();
    const store = new Map<string, unknown>();
    const deletes: string[] = [];
    const f = mockFetch(
      {
        method: "POST",
        url: `${G}/calendars/me%40example.com/events`,
        // Google creates the event, but the answer never reaches us.
        handler: (req) => (store.set((req.body as { id: string }).id, req.body), mockResponse({ error: { code: 503, message: "Backend Error" } }, { status: 503 })),
      },
      {
        method: "DELETE",
        url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/me%40example\\.com/events/([^/?]+)`),
        handler: (req) => (deletes.push(req.params[0]!), store.delete(req.params[0]!) ? new Response(null, { status: 204 }) : mockResponse({ error: { code: 404, message: "Not Found" } }, { status: 404 })),
      },
    );
    try {
      const r = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se) });
      expect(r).toMatchObject({ status: "pending", externalId: null });
      await deleteLinkedEvent({ linkedEventId: r.linkedEventId, notifyAttendees: true });
      expect(store.size).toBe(0);
      expect(deletes[0]).toBe(providerEventIdFor(r.linkedEventId));
      expect(f.callsTo("/events/", "DELETE")[0]!.url.searchParams.get("sendUpdates")).toBe("all");
      const [row] = await t.db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, r.linkedEventId));
      expect(row?.status).toBe("deleted");
      // A row that never reached the provider needs no call at all.
      const { scheduledEvent: other } = await createBooking(t.db, { eventType: (await createEventType(t.db, { owner: g.user })).eventType, start: new Date(Date.now() + 5 * 86_400_000) });
      const [fresh] = await t.db
        .insert(calendarLinkedEvents)
        .values({ userId: g.user.id, connectionId: g.connectionId, calendarId: g.calendarIds[0]!, purpose: "meeting", scheduledEventId: other.id, idempotencyKey: `meeting:${other.id}:${g.user.id}`, status: "pending" })
        .returning();
      const before = deletes.length;
      await deleteLinkedEvent({ linkedEventId: fresh!.id, notifyAttendees: false });
      expect(deletes.length).toBe(before);
    } finally {
      f.restore();
    }
  });

  it("re-points linked events to the new scheduled event", async () => {
    h.useFake = true;
    const { g, eventType, scheduledEvent: se } = await meeting();
    const r = await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: se.id, event: event(se) });
    const { scheduledEvent: next } = await createBooking(t.db, { eventType, start: new Date(Date.now() + 4 * 86_400_000) });
    await repointLinkedEvents({ fromScheduledEventId: se.id, toScheduledEventId: next.id });
    const [row] = await t.db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, r.linkedEventId));
    expect(row).toMatchObject({ scheduledEventId: next.id, idempotencyKey: `meeting:${next.id}:${g.user.id}` });
    // The next write for the new meeting updates the same provider event.
    await upsertLinkedEvent({ userId: g.user.id, purpose: "meeting", scheduledEventId: next.id, event: event(next) });
    expect(fakeCalendarProvider("google").calls.filter((x) => x.method === "createEvent")).toHaveLength(1);
    expect(fakeCalendarProvider("google").calls.filter((x) => x.method === "updateEvent")).toHaveLength(1);
  });
});
