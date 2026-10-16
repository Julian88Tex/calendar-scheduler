// Google Meet provisioning end to end on PGlite with a mocked Google Calendar API (SPEC VID-07, VID-11, VID-12, VID-14):
// createConference queues Meet only for a Google destination (honoring the event type override), the calendar event
// write returns the Meet link that applyLinkedEventConference stores, a pending Meet becomes "initiated" and
// refreshMeetingConference stores the link once Google has it, and the stable join link follows every step. Other
// kinds: Jitsi rooms, everything else not_configured.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (connectionId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  encryptedTokenColumns: async () => ({}),
}));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { eventTypes, scheduledEvents, users } = await import("@/db/schema");
const conferencing = await import("@/lib/conferencing");
const { upsertLinkedEvent } = await import("@/lib/calendars");
const { googleTiming } = await import("@/lib/calendars/providers/google");
const { GET } = await import("@/app/events/[id]/join/route");
const { createBooking, createCalendarConnection, createEventType, createUser, googleMeetLocation } = await import("../factories");
const { mockFetch } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
type ResolvedLocation = import("@/db/types").ResolvedLocation;

const t = useTestDb();
const G = "https://www.googleapis.com/calendar/v3";

beforeEach(() => {
  googleTiming.meetPollDelaysMs = [0, 0, 0];
});

async function setup(opts: { destination?: boolean } = {}) {
  const user = await createUser(t.db, { timezone: "America/Los_Angeles" });
  const { calendars: cals } = await createCalendarConnection(t.db, {
    userId: user.id,
    provider: "google",
    accountEmail: "host@example.com",
    calendars: [{ externalId: "host@example.com", isPrimary: true, canWrite: true, checkConflicts: true }],
  });
  if (opts.destination !== false) await t.db.update(users).set({ destinationCalendarId: cals[0]!.id }).where(eq(users.id, user.id));
  const config = googleMeetLocation();
  const { eventType } = await createEventType(t.db, { owner: user, name: "30 Minute Virtual", durationMinutes: 30, locations: [config] });
  const queued: ResolvedLocation = {
    configId: config.id,
    kind: "google_conference",
    location: null,
    additionalInfo: null,
    joinUrl: null,
    status: "processing",
    providerMeetingId: null,
    password: null,
    dialIn: null,
    data: null,
    error: null,
  };
  const { scheduledEvent } = await createBooking(t.db, { eventType, start: new Date(Date.now() + 3 * 86_400_000), location: queued });
  return { user, calendarId: cals[0]!.id, eventType, scheduledEvent, queued };
}

const join = async (id: string, qs = "") => GET(new Request(`http://localhost:3000/events/${id}/join${qs}`), { params: Promise.resolve({ id }) });

function writeInput(se: { id: string; startAt: Date; endAt: Date; icsUid: string }, kind: ResolvedLocation["kind"]) {
  return {
    title: "Sam Lee and Host",
    descriptionText: "Event Name: 30 Minute Virtual",
    location: null,
    start: se.startAt,
    end: se.endAt,
    attendees: [{ email: "sam@example.com", name: "Sam Lee" }],
    sendInvitations: true,
    conference: conferencing.calendarConferenceFor(kind),
    transparency: "busy" as const,
    icalUid: se.icsUid,
  };
}

async function storedLocation(id: string): Promise<ResolvedLocation> {
  const [row] = await t.db.select({ location: scheduledEvents.location }).from(scheduledEvents).where(eq(scheduledEvents.id, id));
  return row!.location;
}

const createArgs = (s: Awaited<ReturnType<typeof setup>>, kind: import("@/lib/conferencing").ConferenceKind = "google_conference") => ({
  kind,
  organizerUserId: s.user.id,
  scheduledEventId: s.scheduledEvent.id,
  title: "30 Minute Virtual",
  start: s.scheduledEvent.startAt,
  end: s.scheduledEvent.endAt,
  timeZone: "America/Los_Angeles",
  inviteeEmails: ["sam@example.com"],
  location: s.queued,
});

describe("Google Meet provisioning", () => {
  it("queues Meet, stores the link from the Google event and redirects the join link (VID-07 acceptance)", async () => {
    const s = await setup();
    const queued = await conferencing.createConference(createArgs(s));
    expect(queued).toMatchObject({ kind: "google_conference", configId: s.queued.configId, status: "processing", error: null });
    expect(queued.data).toMatchObject({ provider: "google_meet", calendarId: s.calendarId });

    let insertBody: Record<string, unknown> | null = null;
    const f = mockFetch({
      method: "POST",
      url: `${G}/calendars/host%40example.com/events`,
      handler: (req) => {
        insertBody = req.body as Record<string, unknown>;
        return {
          ...(req.body as object),
          status: "confirmed",
          iCalUID: "abc@google.com",
          htmlLink: "https://www.google.com/calendar/event?eid=abc",
          hangoutLink: "https://meet.google.com/abc-defg-hij",
          conferenceData: {
            conferenceId: "abc-defg-hij",
            createRequest: { status: { statusCode: "success" } },
            entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij", label: "meet.google.com/abc-defg-hij" }],
          },
          etag: '"1"',
        };
      },
    });
    try {
      const res = await upsertLinkedEvent({ userId: s.user.id, purpose: "meeting", scheduledEventId: s.scheduledEvent.id, event: writeInput(s.scheduledEvent, queued.kind) });
      expect(f.callsTo("/events", "POST")[0]!.url.searchParams.get("conferenceDataVersion")).toBe("1");
      expect((insertBody as unknown as { conferenceData: { createRequest: { conferenceSolutionKey: { type: string } } } }).conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
      const loc = conferencing.applyLinkedEventConference(queued, res);
      expect(loc).toMatchObject({ status: "pushed", joinUrl: "https://meet.google.com/abc-defg-hij", providerMeetingId: "abc-defg-hij", configId: s.queued.configId });
      expect(loc.data).toMatchObject({ linkedEventId: res.linkedEventId });
      await t.db.update(scheduledEvents).set({ location: loc }).where(eq(scheduledEvents.id, s.scheduledEvent.id));
    } finally {
      f.restore();
    }

    const r = await join(s.scheduledEvent.id);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://meet.google.com/abc-defg-hij");
    expect(r.headers.get("cache-control")).toContain("no-store");
  });

  it("marks a pending Meet as initiated, then refreshMeetingConference stores the link", async () => {
    const s = await setup();
    const queued = await conferencing.createConference(createArgs(s));
    let reads = 0;
    let ready = false;
    const pendingEvent = (id: string) => ({
      id,
      status: "confirmed",
      iCalUID: `${id}@google.com`,
      conferenceData: { createRequest: { status: { statusCode: "pending" } } },
      etag: '"1"',
    });
    const f = mockFetch(
      {
        method: "POST",
        url: `${G}/calendars/host%40example.com/events`,
        handler: (req) => pendingEvent((req.body as { id: string }).id),
      },
      {
        method: "GET",
        url: `${G}/calendars/host%40example.com/events/`,
        handler: (req) => {
          reads++;
          const id = req.url.pathname.split("/").pop()!;
          if (!ready) return pendingEvent(id);
          return {
            ...pendingEvent(id),
            hangoutLink: "https://meet.google.com/xyz-abcd-efg",
            conferenceData: { conferenceId: "xyz-abcd-efg", createRequest: { status: { statusCode: "success" } }, entryPoints: [] },
          };
        },
      },
    );
    try {
      const res = await upsertLinkedEvent({ userId: s.user.id, purpose: "meeting", scheduledEventId: s.scheduledEvent.id, event: writeInput(s.scheduledEvent, queued.kind) });
      expect(reads).toBe(3); // VID-07: re-read up to 3 times
      const initiated = conferencing.applyLinkedEventConference(queued, res);
      expect(initiated).toMatchObject({ status: "initiated", joinUrl: null });
      await t.db.update(scheduledEvents).set({ location: initiated }).where(eq(scheduledEvents.id, s.scheduledEvent.id));

      const preparing = await join(s.scheduledEvent.id);
      expect(preparing.status).toBe(200);
      expect(await preparing.text()).toContain("Your meeting link is being prepared. This page will refresh automatically.");

      // Still pending: nothing stored.
      expect(await conferencing.refreshMeetingConference(s.scheduledEvent.id)).toBeNull();
      expect((await storedLocation(s.scheduledEvent.id)).status).toBe("initiated");

      ready = true;
      const refreshed = await conferencing.refreshMeetingConference(s.scheduledEvent.id);
      expect(refreshed).toMatchObject({ status: "pushed", joinUrl: "https://meet.google.com/xyz-abcd-efg" });
      expect(await storedLocation(s.scheduledEvent.id)).toMatchObject({ status: "pushed", joinUrl: "https://meet.google.com/xyz-abcd-efg", providerMeetingId: "xyz-abcd-efg" });
      // Nothing left to refresh.
      expect(await conferencing.refreshMeetingConference(s.scheduledEvent.id)).toBeNull();
    } finally {
      f.restore();
    }
    const r = await join(s.scheduledEvent.id);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://meet.google.com/xyz-abcd-efg");
  });

  it("returns an already created conference unchanged when provisioning runs again (review regression)", async () => {
    const s = await setup();
    const jitsi = await conferencing.createConference(createArgs(s, "jitsi_conference"));
    // A retried job must not mint a second room: the invitee was already sent the first one.
    expect(await conferencing.createConference({ ...createArgs(s, "jitsi_conference"), location: jitsi })).toBe(jitsi);
    const meet: ResolvedLocation = { ...s.queued, status: "pushed", joinUrl: "https://meet.google.com/abc-defg-hij", location: "https://meet.google.com/abc-defg-hij" };
    expect(await conferencing.createConference({ ...createArgs(s), location: meet })).toBe(meet);
    // A failed or reset conference is requested again; another kind is not reused.
    expect(await conferencing.createConference({ ...createArgs(s), location: { ...meet, status: "failed" } })).toMatchObject({ status: "processing", joinUrl: null });
    expect(await conferencing.createConference({ ...createArgs(s), location: conferencing.resetConference(meet) })).toMatchObject({ status: "processing", joinUrl: null });
    expect(await conferencing.createConference({ ...createArgs(s), location: jitsi })).toMatchObject({ kind: "google_conference", status: "processing" });
  });

  it("folds a refreshed link into the meeting as it is at write time and skips a changed organizer (review regression)", async () => {
    const s = await setup();
    const other = await createUser(t.db);
    const pendingEvent = (id: string, link: boolean) => ({
      id,
      status: "confirmed",
      iCalUID: `${id}@google.com`,
      ...(link ? { hangoutLink: "https://meet.google.com/late-link-abc" } : {}),
      conferenceData: { conferenceId: link ? "late-link-abc" : undefined, createRequest: { status: { statusCode: link ? "success" : "pending" } } },
      etag: '"1"',
    });
    let onRead: (() => Promise<void>) | null = null;
    let ready = false;
    const f = mockFetch(
      { method: "POST", url: `${G}/calendars/host%40example.com/events`, handler: (req) => pendingEvent((req.body as { id: string }).id, false) },
      {
        method: "GET",
        url: `${G}/calendars/host%40example.com/events/`,
        handler: async (req) => {
          const id = req.url.pathname.split("/").pop()!;
          if (ready && onRead) await onRead();
          return pendingEvent(id, ready);
        },
      },
    );
    try {
      const queued = await conferencing.createConference(createArgs(s));
      const res = await upsertLinkedEvent({ userId: s.user.id, purpose: "meeting", scheduledEventId: s.scheduledEvent.id, event: writeInput(s.scheduledEvent, queued.kind) });
      const initiated = conferencing.applyLinkedEventConference(queued, res);
      await t.db.update(scheduledEvents).set({ location: initiated }).where(eq(scheduledEvents.id, s.scheduledEvent.id));
      ready = true;

      // The host edits the location notes while Google is being asked: the note survives the refresh.
      onRead = async () => {
        await t.db.update(scheduledEvents).set({ location: { ...initiated, additionalInfo: "Bring the agenda" } }).where(eq(scheduledEvents.id, s.scheduledEvent.id));
      };
      expect(await conferencing.refreshMeetingConference(s.scheduledEvent.id)).toMatchObject({ status: "pushed", additionalInfo: "Bring the agenda" });
      expect(await storedLocation(s.scheduledEvent.id)).toMatchObject({ status: "pushed", joinUrl: "https://meet.google.com/late-link-abc", additionalInfo: "Bring the agenda" });

      // A reassignment to another organizer while Google answered: the old organizer's link is not stored.
      await t.db.update(scheduledEvents).set({ location: initiated }).where(eq(scheduledEvents.id, s.scheduledEvent.id));
      onRead = async () => {
        await t.db.update(scheduledEvents).set({ organizerUserId: other.id }).where(eq(scheduledEvents.id, s.scheduledEvent.id));
      };
      expect(await conferencing.refreshMeetingConference(s.scheduledEvent.id)).toBeNull();
      expect(await storedLocation(s.scheduledEvent.id)).toEqual(initiated);
    } finally {
      f.restore();
    }
  });

  it("never overwrites a meeting canceled or changed while the refresh ran", async () => {
    const s = await setup();
    const initiated: ResolvedLocation = { ...s.queued, status: "initiated", data: { provider: "google_meet" } };
    await t.db.update(scheduledEvents).set({ location: initiated, status: "canceled" }).where(eq(scheduledEvents.id, s.scheduledEvent.id));
    expect(await conferencing.refreshMeetingConference(s.scheduledEvent.id)).toBeNull();
    expect(await conferencing.refreshMeetingConference("not-a-uuid")).toBeNull();
    // Active but no calendar event yet: nothing to read.
    await t.db.update(scheduledEvents).set({ status: "active" }).where(eq(scheduledEvents.id, s.scheduledEvent.id));
    expect(await conferencing.refreshMeetingConference(s.scheduledEvent.id)).toBeNull();
    expect(await storedLocation(s.scheduledEvent.id)).toEqual(initiated);
  });

  it("falls back to 'Web conferencing details to follow.' without a Google destination (VID-07)", async () => {
    const s = await setup({ destination: false });
    const loc = await conferencing.createConference(createArgs(s));
    expect(loc).toMatchObject({ status: "failed", error: "meet_requires_google_calendar", joinUrl: null, configId: s.queued.configId });
    expect(conferencing.conferenceErrorMessage(loc.error, loc.kind)).toBe(conferencing.CONFERENCING_COPY.meetRequiresGoogle);
    await t.db.update(scheduledEvents).set({ location: loc }).where(eq(scheduledEvents.id, s.scheduledEvent.id));
    const r = await join(s.scheduledEvent.id);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Web conferencing details to follow.");
    // The write itself is skipped too.
    const res = await upsertLinkedEvent({ userId: s.user.id, purpose: "meeting", scheduledEventId: s.scheduledEvent.id, event: writeInput(s.scheduledEvent, "google_conference") });
    expect(conferencing.applyLinkedEventConference({ ...loc, status: "processing", error: null }, res)).toMatchObject({ status: "failed", error: "meet_requires_google_calendar" });
  });

  it("honors the event type's calendar override", async () => {
    const s = await setup({ destination: false });
    await t.db.update(eventTypes).set({ destinationCalendarId: s.calendarId }).where(eq(eventTypes.id, s.eventType.id));
    const loc = await conferencing.createConference(createArgs(s));
    expect(loc).toMatchObject({ status: "processing", data: { calendarId: s.calendarId } });
    // Explicit event type id (no meeting lookup).
    const loc2 = await conferencing.createConference({ ...createArgs(s), scheduledEventId: "unknown", eventTypeId: s.eventType.id });
    expect(loc2.status).toBe("processing");
  });

  it("creates Jitsi rooms and refuses kinds this server does not offer", async () => {
    const s = await setup();
    const jitsi = await conferencing.createConference(createArgs(s, "jitsi_conference"));
    expect(jitsi).toMatchObject({ status: "pushed", configId: s.queued.configId });
    expect(jitsi.joinUrl).toMatch(/^https:\/\/meet\.jit\.si\/kairos-[a-z0-9]{20}$/);
    for (const kind of ["zoom_conference", "microsoft_teams_conference", "webex_conference", "gotomeeting_conference"] as const) {
      expect(await conferencing.createConference(createArgs(s, kind))).toMatchObject({ kind, status: "failed", error: "not_configured" });
    }
  });

  it("keeps conferences on reschedule and recreates them for a new organizer (VID-14)", async () => {
    const pushed: ResolvedLocation = {
      configId: "c",
      kind: "google_conference",
      location: "https://meet.google.com/abc",
      additionalInfo: "Notes",
      joinUrl: "https://meet.google.com/abc",
      status: "pushed",
      providerMeetingId: "abc",
      password: null,
      dialIn: null,
      data: null,
      error: null,
    };
    const moved = await conferencing.updateConference({ location: pushed, organizerUserId: "u1", title: "x", start: new Date(), end: new Date(), timeZone: "UTC" });
    expect(moved).toBe(pushed);
    await expect(conferencing.deleteConference({ location: pushed, organizerUserId: "u1" })).resolves.toBeUndefined();
    expect(conferencing.conferenceNeedsRecreate({ location: pushed, previousOrganizerUserId: "u1", organizerUserId: "u1" })).toBe(false);
    expect(conferencing.conferenceNeedsRecreate({ location: pushed, previousOrganizerUserId: "u1", organizerUserId: "u2" })).toBe(true);
    expect(conferencing.conferenceNeedsRecreate({ location: { ...pushed, status: "failed" }, previousOrganizerUserId: "u1", organizerUserId: "u1" })).toBe(true);
    expect(conferencing.conferenceNeedsRecreate({ location: { ...pushed, kind: "jitsi_conference" }, previousOrganizerUserId: "u1", organizerUserId: "u2" })).toBe(false);
    expect(conferencing.conferenceNeedsRecreate({ location: { ...pushed, kind: "physical" }, previousOrganizerUserId: "u1", organizerUserId: "u2" })).toBe(false);
    expect(conferencing.resetConference(pushed)).toMatchObject({ status: "processing", joinUrl: null, configId: "c", additionalInfo: "Notes" });
  });

  it("resolves the conference organizer (VID-13)", () => {
    const hosts = [
      { userId: "pool-host", poolId: "p1" },
      { userId: "required", poolId: null },
      { userId: "chosen", poolId: null },
    ];
    expect(conferencing.resolveConferenceOrganizer({ organizerUserId: "owner", hosts, preferredOrganizerUserId: "chosen" })).toBe("chosen");
    expect(conferencing.resolveConferenceOrganizer({ organizerUserId: "owner", hosts, preferredOrganizerUserId: "absent" })).toBe("required");
    expect(conferencing.resolveConferenceOrganizer({ organizerUserId: "owner", hosts: [{ userId: "rr", poolId: "p1" }] })).toBe("rr");
    expect(conferencing.resolveConferenceOrganizer({ organizerUserId: "owner" })).toBe("owner");
  });
});
