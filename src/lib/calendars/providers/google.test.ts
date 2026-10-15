// Google Calendar provider against mocked endpoints (SPEC CAL-02, CAL-11, CAL-12, SCH-12, VID-07).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockFetch, mockResponse, type MockFetch, type MockRequest } from "../../../../tests/helpers/fake-providers";
import {
  differsFromInput,
  FREEBUSY_MAX_ITEMS,
  GOOGLE_BUSY_EVENT_TYPES,
  googleProvider,
  googleTiming,
  mapGoogleEvent,
  readGoogleConference,
  watchGoogleEvents,
  type GoogleEvent,
} from "./google";
import { ProviderAuthError, ProviderRequestError, ProviderTransientError, type ConnectionContext, type WriteEventInput } from "./types";

const G = "https://www.googleapis.com/calendar/v3";
const ctx: ConnectionContext = { connectionId: "c1", userId: "u1", provider: "google", accessToken: "at-1", unavailableStatuses: [] };

let f: MockFetch;
beforeEach(() => {
  googleTiming.meetPollDelaysMs = [0, 0, 0];
});
afterEach(() => f?.restore());

const write = (over: Partial<WriteEventInput> = {}): WriteEventInput => ({
  title: "Sam Lee and Julian",
  descriptionText: "Event Name: 30 Minute Virtual",
  location: null,
  start: new Date("2026-10-20T17:00:00Z"),
  end: new Date("2026-10-20T17:30:00Z"),
  attendees: [{ email: "sam@example.com", name: "Sam Lee" }, { email: "SAM@example.com" }, { email: "guest@example.com" }],
  sendInvitations: true,
  conference: "google_meet",
  transparency: "busy",
  icalUid: "abc@kairos",
  idempotencyKey: "0f8fad5bd9cb469fa16570867728950e",
  privateProperties: { kairosEventId: "e1", kairosPurpose: "meeting", kairosLinkedEventId: "l1" },
  ...over,
});

describe("busy mapping (SCH-12)", () => {
  const base = { id: "x", status: "confirmed" as const, start: { dateTime: "2026-10-20T15:00:00Z" }, end: { dateTime: "2026-10-20T16:00:00Z" } };
  it("follows transparency, status, declined responses and event types", () => {
    expect(mapGoogleEvent(base)?.busy).toBe(true);
    expect(mapGoogleEvent({ ...base, transparency: "transparent" })?.busy).toBe(false);
    expect(mapGoogleEvent({ ...base, status: "cancelled" })?.busy).toBe(false);
    expect(mapGoogleEvent({ ...base, attendees: [{ self: true, responseStatus: "declined" }] })?.busy).toBe(false);
    expect(mapGoogleEvent({ ...base, attendees: [{ self: true, responseStatus: "tentative" }] })?.busy).toBe(true);
    expect(mapGoogleEvent({ ...base, attendees: [{ self: true, responseStatus: "needsAction" }] })?.busy).toBe(true);
    expect(mapGoogleEvent({ ...base, eventType: "outOfOffice", transparency: "transparent" })?.busy).toBe(true);
    expect(mapGoogleEvent({ ...base, eventType: "focusTime" })?.busy).toBe(true);
    expect(mapGoogleEvent({ ...base, eventType: "focusTime", transparency: "transparent" })?.busy).toBe(false);
    expect(mapGoogleEvent({ ...base, eventType: "birthday", transparency: "transparent" })?.busy).toBe(false);
    expect(mapGoogleEvent({ ...base, eventType: "workingLocation" })).toBeNull();
  });

  it("keeps all-day calendar dates (end exclusive) with UTC midnight placeholders", () => {
    const ev = mapGoogleEvent({ id: "a", start: { date: "2026-10-20" }, end: { date: "2026-10-22" }, summary: "Offsite" });
    expect(ev).toMatchObject({ allDay: true, allDayStartDate: "2026-10-20", allDayEndDate: "2026-10-22", title: "Offsite", busy: true });
    expect(ev?.start.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(ev?.end.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    const single = mapGoogleEvent({ id: "b", start: { date: "2026-10-20" } });
    expect(single?.allDayEndDate).toBe("2026-10-21");
  });

  it("treats an event without a usable end as zero length and names untitled out of office events", () => {
    const ev = mapGoogleEvent({ id: "z", eventType: "outOfOffice", start: { dateTime: "2026-10-20T15:00:00-07:00" } });
    expect(ev?.start.toISOString()).toBe("2026-10-20T22:00:00.000Z");
    expect(ev?.end.getTime()).toBe(ev?.start.getTime());
    expect(ev?.title).toBe("Out of office");
  });
});

describe("googleProvider", () => {
  it("lists calendars with writability, colors and pagination", async () => {
    f = mockFetch({
      method: "GET",
      url: `${G}/users/me/calendarList`,
      handler: (req) =>
        req.url.searchParams.get("pageToken")
          ? { items: [{ id: "team@group.calendar.google.com", summary: "Team", accessRole: "reader", backgroundColor: "#0b8043" }] }
          : {
              nextPageToken: "p2",
              items: [
                { id: "work@group.calendar.google.com", summary: "Work", summaryOverride: "My work", accessRole: "writer", backgroundColor: "#7986cb" },
                { id: "me@example.com", summary: "me@example.com", primary: true, accessRole: "owner", timeZone: "America/Los_Angeles", conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] } },
              ],
            },
    });
    const cals = await googleProvider.listCalendars(ctx);
    expect(cals.map((c) => [c.externalId, c.name, c.isPrimary, c.canWrite])).toEqual([
      ["me@example.com", "me@example.com", true, true],
      ["work@group.calendar.google.com", "My work", false, true],
      ["team@group.calendar.google.com", "Team", false, false],
    ]);
    expect(cals[0]?.allowedOnlineMeetingProviders).toEqual(["hangoutsMeet"]);
    expect(cals.map((c) => c.busyOnly)).toEqual([false, false, false]);
    expect(f.calls[0]?.url.searchParams.get("minAccessRole")).toBe("freeBusyReader");
    expect(f.calls[0]?.headers.get("authorization")).toBe("Bearer at-1");
  });

  it("lists events with explicit eventTypes, singleEvents and paging, skipping working locations and cancelled", async () => {
    f = mockFetch({
      method: "GET",
      url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/([^/]+)/events\\?`),
      handler: (req) =>
        req.url.searchParams.get("pageToken")
          ? { items: [{ id: "ooo", eventType: "outOfOffice", start: { dateTime: "2026-10-21T08:00:00Z" }, end: { dateTime: "2026-10-21T17:00:00Z" } }] }
          : {
              nextPageToken: "next",
              items: [
                { id: "busy", summary: "Dentist", start: { dateTime: "2026-10-20T15:00:00Z" }, end: { dateTime: "2026-10-20T16:00:00Z" } },
                { id: "free", summary: "Lunch?", transparency: "transparent", start: { dateTime: "2026-10-20T19:00:00Z" }, end: { dateTime: "2026-10-20T20:00:00Z" } },
                { id: "wl", eventType: "workingLocation", start: { date: "2026-10-20" }, end: { date: "2026-10-21" } },
                { id: "gone", status: "cancelled", start: { dateTime: "2026-10-20T10:00:00Z" }, end: { dateTime: "2026-10-20T11:00:00Z" } },
                { id: "day", summary: "Holiday", start: { date: "2026-10-22" }, end: { date: "2026-10-23" } },
              ],
            },
    });
    const range = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") };
    const res = await googleProvider.listEvents(ctx, ["me@example.com"], range);
    expect(res["me@example.com"]?.map((e) => [e.externalId, e.busy])).toEqual([
      ["busy", true],
      ["free", false],
      ["day", true],
      ["ooo", true],
    ]);
    const q = f.calls[0]!.url.searchParams;
    expect(q.getAll("eventTypes")).toEqual([...GOOGLE_BUSY_EVENT_TYPES]);
    expect(q.getAll("eventTypes")).not.toContain("workingLocation");
    expect(q.get("singleEvents")).toBe("true");
    expect(q.get("timeMin")).toBe("2026-10-01T00:00:00.000Z");
    expect(q.get("timeMax")).toBe("2026-11-01T00:00:00.000Z");
    expect(q.get("maxAttendees")).toBe("1");
    expect(f.calls[0]!.url.pathname).toContain(encodeURIComponent("me@example.com"));
    expect(f.calls).toHaveLength(2);
  });

  it("leaves out a calendar that no longer exists", async () => {
    f = mockFetch(
      { method: "GET", url: `${G}/calendars/`, handler: () => mockResponse({ error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } }, { status: 404 }) },
      { method: "POST", url: `${G}/freeBusy`, handler: () => ({ calendars: { "gone@group.calendar.google.com": { errors: [{ domain: "global", reason: "notFound" }], busy: [] } } }) },
    );
    const res = await googleProvider.listEvents(ctx, ["gone@group.calendar.google.com"], { start: new Date(0), end: new Date(86_400_000) });
    expect(res).toEqual({});
  });

  it("creates an invitation-mode event with attendees, sendUpdates=all, our id and a Meet link", async () => {
    let body: Record<string, unknown> = {};
    f = mockFetch({
      method: "POST",
      url: `${G}/calendars/me%40example.com/events`,
      handler: (req: MockRequest) => {
        body = req.body as Record<string, unknown>;
        return { ...body, iCalUID: `${body.id as string}@google.com`, htmlLink: "https://www.google.com/calendar/event?eid=1", hangoutLink: "https://meet.google.com/abc-defg-hij", conferenceData: { conferenceId: "abc-defg-hij", createRequest: { status: { statusCode: "success" } } }, etag: '"1"' };
      },
    });
    const res = await googleProvider.createEvent(ctx, "me@example.com", write());
    const q = f.calls[0]!.url.searchParams;
    expect(q.get("sendUpdates")).toBe("all");
    expect(q.get("conferenceDataVersion")).toBe("1");
    expect(body.id).toBe("0f8fad5bd9cb469fa16570867728950e");
    expect(body.attendees).toEqual([{ email: "sam@example.com", displayName: "Sam Lee" }, { email: "guest@example.com" }]);
    expect(body.conferenceData).toEqual({ createRequest: { requestId: "0f8fad5bd9cb469fa16570867728950e", conferenceSolutionKey: { type: "hangoutsMeet" } } });
    expect(body.extendedProperties).toEqual({ private: { kairosEventId: "e1", kairosPurpose: "meeting", kairosLinkedEventId: "l1" } });
    expect(body.start).toEqual({ dateTime: "2026-10-20T17:00:00.000Z" });
    expect(body.transparency).toBe("opaque");
    expect(res).toMatchObject({
      externalId: "0f8fad5bd9cb469fa16570867728950e",
      icalUid: "0f8fad5bd9cb469fa16570867728950e@google.com",
      htmlLink: "https://www.google.com/calendar/event?eid=1",
      conference: { joinUrl: "https://meet.google.com/abc-defg-hij", status: "pushed" },
    });
  });

  it("creates an email-mode event with no attendees and sendUpdates=none", async () => {
    let body: Record<string, unknown> = {};
    f = mockFetch({ method: "POST", url: `${G}/calendars/`, handler: (req) => ((body = req.body as Record<string, unknown>), { ...body, iCalUID: "x@google.com" }) });
    await googleProvider.createEvent(ctx, "me@example.com", write({ sendInvitations: false, conference: null, location: "Blue Bottle Coffee" }));
    expect(f.calls[0]!.url.searchParams.get("sendUpdates")).toBe("none");
    expect(body.attendees).toEqual([]);
    expect(body.conferenceData).toBeUndefined();
    expect(body.location).toBe("Blue Bottle Coffee");
  });

  it("resolves a duplicate id (retry after a timeout) to the event the first attempt created", async () => {
    f = mockFetch(
      { method: "POST", url: `${G}/calendars/`, handler: () => mockResponse({ error: { code: 409, message: "The requested identifier already exists.", errors: [{ reason: "duplicate" }] } }, { status: 409 }) },
      {
        method: "GET",
        url: `${G}/calendars/me%40example.com/events/0f8fad5bd9cb469fa16570867728950e`,
        // What the first attempt wrote (same times, title, details and guests).
        handler: () => ({
          id: "0f8fad5bd9cb469fa16570867728950e",
          status: "confirmed",
          summary: "Sam Lee and Julian",
          description: "Event Name: 30 Minute Virtual",
          start: { dateTime: "2026-10-20T10:00:00-07:00" },
          end: { dateTime: "2026-10-20T10:30:00-07:00" },
          attendees: [{ email: "sam@example.com" }, { email: "guest@example.com" }],
          iCalUID: "dup@google.com",
          htmlLink: "https://g/1",
          hangoutLink: "https://meet.google.com/xyz",
        }),
      },
    );
    const res = await googleProvider.createEvent(ctx, "me@example.com", write());
    expect(res).toMatchObject({ externalId: "0f8fad5bd9cb469fa16570867728950e", icalUid: "dup@google.com", conference: { joinUrl: "https://meet.google.com/xyz" } });
    expect(f.callsTo("/events", "POST")).toHaveLength(1);
  });

  it("re-reads a pending Meet conference until the link exists", async () => {
    let reads = 0;
    f = mockFetch(
      { method: "POST", url: `${G}/calendars/`, handler: () => ({ id: "e1", conferenceData: { createRequest: { status: { statusCode: "pending" } } } }) },
      {
        method: "GET",
        url: `${G}/calendars/me%40example.com/events/e1`,
        handler: () => (++reads < 2 ? { id: "e1", conferenceData: { createRequest: { status: { statusCode: "pending" } } } } : { id: "e1", hangoutLink: "https://meet.google.com/late-link", conferenceData: { createRequest: { status: { statusCode: "success" } } } }),
      },
    );
    const res = await googleProvider.createEvent(ctx, "me@example.com", write());
    expect(res.conference).toMatchObject({ joinUrl: "https://meet.google.com/late-link", status: "pushed" });
    expect(reads).toBe(2);
    expect(await readGoogleConference(ctx, "me@example.com", "e1")).toMatchObject({ joinUrl: "https://meet.google.com/late-link" });
  });

  it("patches with sendUpdates and the stable conference request id, and treats deleted events as gone", async () => {
    let body: Record<string, unknown> = {};
    f = mockFetch(
      { method: "PATCH", url: `${G}/calendars/me%40example.com/events/e1`, handler: (req) => ((body = req.body as Record<string, unknown>), { id: "e1", etag: '"2"', hangoutLink: "https://meet.google.com/same" }) },
      { method: "DELETE", url: `${G}/calendars/me%40example.com/events/e2`, handler: () => mockResponse({ error: { code: 410, message: "Resource has been deleted" } }, { status: 410 }) },
      { method: "GET", url: `${G}/calendars/me%40example.com/events/e3`, handler: () => mockResponse({ error: { code: 404, message: "Not Found" } }, { status: 404 }) },
      { method: "GET", url: (u) => u.pathname.endsWith("/calendars/me%40example.com"), handler: () => ({ id: "me@example.com", summary: "Me" }) },
    );
    const res = await googleProvider.updateEvent(ctx, "me@example.com", "e1", write({ idempotencyKey: "e1", sendInvitations: false }));
    expect(f.calls[0]!.url.searchParams.get("sendUpdates")).toBe("none");
    expect(body.id).toBeUndefined();
    expect(body.location).toBe("");
    expect((body.conferenceData as { createRequest: { requestId: string } }).createRequest.requestId).toBe("e1");
    expect(res).toMatchObject({ externalId: "e1", etag: '"2"', conference: { joinUrl: "https://meet.google.com/same" } });
    await expect(googleProvider.deleteEvent(ctx, "me@example.com", "e2", { notifyAttendees: true })).resolves.toBeUndefined();
    expect(f.calls[1]!.url.searchParams.get("sendUpdates")).toBe("all");
    expect(await googleProvider.getEvent(ctx, "me@example.com", "e3")).toBeNull();
  });

  it("brings the event of an earlier attempt up to date when the meeting changed before the retry (409)", async () => {
    const created: GoogleEvent = { id: "0f8fad5bd9cb469fa16570867728950e", status: "confirmed", summary: "Sam Lee and Julian", description: "Event Name: 30 Minute Virtual", start: { dateTime: "2026-10-20T17:00:00Z" }, end: { dateTime: "2026-10-20T17:30:00Z" }, attendees: [{ email: "julian@example.com", organizer: true, self: true }, { email: "sam@example.com" }, { email: "guest@example.com" }], hangoutLink: "https://meet.google.com/xyz", iCalUID: "dup@google.com" };
    let patched: Record<string, unknown> | null = null;
    f = mockFetch(
      { method: "POST", url: `${G}/calendars/`, handler: () => mockResponse({ error: { code: 409, message: "The requested identifier already exists.", errors: [{ reason: "duplicate" }] } }, { status: 409 }) },
      { method: "GET", url: `${G}/calendars/me%40example.com/events/0f8fad5bd9cb469fa16570867728950e`, handler: () => created },
      { method: "PATCH", url: `${G}/calendars/me%40example.com/events/0f8fad5bd9cb469fa16570867728950e`, handler: (req) => ((patched = req.body as Record<string, unknown>), { ...created, ...patched, etag: '"2"' }) },
    );
    // Same meeting: the earlier event is used as is (the full attendee list was read, not only our own entry).
    expect(differsFromInput(created, write())).toBe(false);
    await googleProvider.createEvent(ctx, "me@example.com", write());
    expect(f.callsTo("/events/0f8fad5bd9cb469fa16570867728950e", "GET")[0]!.url.searchParams.get("maxAttendees")).toBeNull();
    expect(patched).toBeNull();
    // The meeting moved by an hour between the attempts: the event is patched, so CAL-14 never sees a host-side move.
    const moved = write({ start: new Date("2026-10-20T18:00:00Z"), end: new Date("2026-10-20T18:30:00Z") });
    expect(differsFromInput(created, moved)).toBe(true);
    expect(differsFromInput(created, write({ attendees: [{ email: "sam@example.com" }] }))).toBe(true);
    const res = await googleProvider.createEvent(ctx, "me@example.com", moved);
    expect(patched).toMatchObject({ start: { dateTime: "2026-10-20T18:00:00.000Z" }, end: { dateTime: "2026-10-20T18:30:00.000Z" } });
    expect(f.callsTo("/events/0f8fad5bd9cb469fa16570867728950e", "PATCH")[0]!.url.searchParams.get("sendUpdates")).toBe("all");
    expect(res).toMatchObject({ externalId: "0f8fad5bd9cb469fa16570867728950e", etag: '"2"' });
  });

  it("counts an event as deleted only while its calendar still answers (404 is also what an unshared calendar returns)", async () => {
    let calendarGone = false;
    f = mockFetch(
      { method: "GET", url: `${G}/calendars/team%40group.calendar.google.com/events/`, handler: () => mockResponse({ error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } }, { status: 404 }) },
      {
        method: "GET",
        url: (u) => u.pathname.endsWith("/calendars/team%40group.calendar.google.com"),
        handler: () => (calendarGone ? mockResponse({ error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } }, { status: 404 }) : { id: "team@group.calendar.google.com" }),
      },
    );
    expect(await googleProvider.getEvent(ctx, "team@group.calendar.google.com", "e1")).toBeNull();
    calendarGone = true;
    await expect(googleProvider.getEvent(ctx, "team@group.calendar.google.com", "e1")).rejects.toMatchObject({ name: "ProviderRequestError", reason: "calendarUnavailable" });
  });

  it("reads a calendar that refuses the eventTypes filter without it, still dropping working locations", async () => {
    f = mockFetch({
      method: "GET",
      url: `${G}/calendars/`,
      handler: (req) =>
        req.url.searchParams.getAll("eventTypes").length
          ? mockResponse({ error: { code: 400, message: "Invalid event type", errors: [{ reason: "invalid" }] } }, { status: 400 })
          : {
              items: [
                { id: "busy", start: { dateTime: "2026-10-20T15:00:00Z" }, end: { dateTime: "2026-10-20T16:00:00Z" } },
                { id: "wl", eventType: "workingLocation", start: { date: "2026-10-20" }, end: { date: "2026-10-21" } },
              ],
            },
    });
    const res = await googleProvider.listEvents(ctx, ["odd@group.calendar.google.com"], { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") });
    expect(res["odd@group.calendar.google.com"]?.map((e) => e.externalId)).toEqual(["busy"]);
    expect(f.calls).toHaveLength(2);
  });

  it("maps errors to auth, transient and request errors", async () => {
    const answer = (status: number, reason?: string, message = "x") => () => mockResponse({ error: { code: status, message, errors: reason ? [{ reason }] : [] } }, { status });
    f = mockFetch({ method: "GET", url: `${G}/users/me/calendarList`, handler: answer(401) });
    await expect(googleProvider.listCalendars(ctx)).rejects.toMatchObject({ name: "ProviderAuthError", reason: "unauthorized" });
    f.restore();
    f = mockFetch({ method: "GET", url: `${G}/users/me/calendarList`, handler: answer(403, "rateLimitExceeded") });
    await expect(googleProvider.listCalendars(ctx)).rejects.toBeInstanceOf(ProviderTransientError);
    f.restore();
    f = mockFetch({ method: "GET", url: `${G}/users/me/calendarList`, handler: answer(403, "insufficientPermissions", "Request had insufficient authentication scopes.") });
    await expect(googleProvider.listCalendars(ctx)).rejects.toMatchObject({ reason: "insufficient_scope" });
    f.restore();
    f = mockFetch({ method: "GET", url: `${G}/users/me/calendarList`, handler: answer(503) });
    await expect(googleProvider.listCalendars(ctx)).rejects.toBeInstanceOf(ProviderTransientError);
    f.restore();
    f = mockFetch({ method: "POST", url: `${G}/calendars/`, handler: answer(403, "requiredAccessLevel") });
    await expect(googleProvider.createEvent(ctx, "ro@group.calendar.google.com", write())).rejects.toBeInstanceOf(ProviderRequestError);
    f.restore();
    f = mockFetch({ method: "GET", url: `${G}/users/me/calendarList`, handler: () => Promise.reject(new TypeError("fetch failed")) });
    await expect(googleProvider.listCalendars(ctx)).rejects.toBeInstanceOf(ProviderTransientError);
    await expect(googleProvider.listCalendars({ ...ctx, accessToken: undefined })).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it("opens a push channel", async () => {
    let body: Record<string, unknown> = {};
    f = mockFetch({ method: "POST", url: `${G}/calendars/me%40example.com/events/watch`, handler: (req) => ((body = req.body as Record<string, unknown>), { id: "ch1", resourceId: "res1", expiration: String(Date.parse("2026-10-27T00:00:00Z")) }) });
    const res = await watchGoogleEvents(ctx, "me@example.com", { channelId: "ch1", address: "https://app.example.com/api/webhooks/calendars/google", token: "tok", ttlSeconds: 604800 });
    expect(body).toMatchObject({ id: "ch1", type: "web_hook", token: "tok", params: { ttl: "604800" } });
    expect(res).toEqual({ channelId: "ch1", resourceId: "res1", expiresAt: new Date("2026-10-27T00:00:00Z") });
  });
});

describe("free/busy only calendars (freeBusyReader)", () => {
  type FreeBusyBody = { timeMin: string; timeMax: string; timeZone: string; items: { id: string }[] };
  const listBusy = googleProvider.listBusy!;

  it("lists them as busy only, never writable, after the readable calendars", async () => {
    f = mockFetch({
      method: "GET",
      url: `${G}/users/me/calendarList`,
      handler: () => ({
        items: [
          { id: "jjoseph@copado.com", summary: "jjoseph@copado.com", accessRole: "freeBusyReader", backgroundColor: "#a47ae2" },
          { id: "holidays@group.v.calendar.google.com", summary: "Holidays", accessRole: "reader" },
          { id: "me@example.com", summary: "me@example.com", primary: true, accessRole: "owner" },
        ],
      }),
    });
    const cals = await googleProvider.listCalendars(ctx);
    expect(cals.map((c) => [c.externalId, c.canWrite, c.busyOnly])).toEqual([
      ["me@example.com", true, false],
      ["holidays@group.v.calendar.google.com", false, false],
      ["jjoseph@copado.com", false, true],
    ]);
  });

  it("reads busy intervals with one batched FreeBusy request, merged per calendar, untitled and busy", async () => {
    const bodies: FreeBusyBody[] = [];
    f = mockFetch({
      method: "POST",
      url: `${G}/freeBusy`,
      handler: (req) => {
        bodies.push(req.body as FreeBusyBody);
        return {
          kind: "calendar#freeBusy",
          calendars: {
            "jjoseph@copado.com": {
              busy: [
                { start: "2026-10-20T16:00:00Z", end: "2026-10-20T17:00:00Z" },
                { start: "2026-10-20T16:30:00Z", end: "2026-10-20T17:30:00Z" },
                { start: "2026-10-20T17:30:00Z", end: "2026-10-20T18:00:00Z" },
                { start: "2026-10-21T09:00:00-07:00", end: "2026-10-21T10:00:00-07:00" },
                { start: "bad", end: "2026-10-21T10:00:00Z" },
              ],
            },
            "team@group.calendar.google.com": { busy: [] },
            "gone@group.calendar.google.com": { errors: [{ domain: "global", reason: "notFound" }], busy: [] },
          },
        };
      },
    });
    const range = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") };
    const res = await listBusy(ctx, ["jjoseph@copado.com", "team@group.calendar.google.com", "gone@group.calendar.google.com"], range);
    expect(bodies).toEqual([
      {
        timeMin: "2026-10-01T00:00:00.000Z",
        timeMax: "2026-11-01T00:00:00.000Z",
        timeZone: "UTC",
        items: [{ id: "jjoseph@copado.com" }, { id: "team@group.calendar.google.com" }, { id: "gone@group.calendar.google.com" }],
      },
    ]);
    expect(f.calls[0]!.headers.get("authorization")).toBe("Bearer at-1");
    expect(Object.keys(res).sort()).toEqual(["jjoseph@copado.com", "team@group.calendar.google.com"]);
    expect(res["team@group.calendar.google.com"]).toEqual([]);
    const work = res["jjoseph@copado.com"]!;
    expect(work.map((e) => [e.start.toISOString(), e.end.toISOString()])).toEqual([
      ["2026-10-20T16:00:00.000Z", "2026-10-20T18:00:00.000Z"],
      ["2026-10-21T16:00:00.000Z", "2026-10-21T17:00:00.000Z"],
    ]);
    expect(work[0]).toMatchObject({ title: null, busy: true, allDay: false, status: "confirmed", externalId: "freebusy:2026-10-20T16:00:00.000Z/2026-10-20T18:00:00.000Z" });
  });

  it("splits more than 50 calendars and more than 31 days into separate requests and joins intervals across them", async () => {
    const bodies: FreeBusyBody[] = [];
    const ids = Array.from({ length: FREEBUSY_MAX_ITEMS + 1 }, (_, i) => `c${i}@group.calendar.google.com`);
    f = mockFetch({
      method: "POST",
      url: `${G}/freeBusy`,
      handler: (req) => {
        const body = req.body as FreeBusyBody;
        bodies.push(body);
        // c0 is busy across the boundary of the two spans (Google clips intervals to each request's range).
        const busy = (id: string) =>
          id === "c0@group.calendar.google.com"
            ? [{ start: body.timeMin < "2026-11-01T00:00:00.000Z" ? "2026-10-31T23:00:00Z" : body.timeMin, end: body.timeMin < "2026-11-01T00:00:00.000Z" ? body.timeMax : "2026-11-01T02:00:00Z" }]
            : [];
        return { calendars: Object.fromEntries(body.items.map((i) => [i.id, { busy: busy(i.id) }])) };
      },
    });
    const range = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-10T00:00:00Z") };
    const res = await listBusy(ctx, ids, range);
    expect(bodies.map((b) => [b.timeMin, b.timeMax, b.items.length])).toEqual([
      ["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", 50],
      ["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", 1],
      ["2026-11-01T00:00:00.000Z", "2026-11-10T00:00:00.000Z", 50],
      ["2026-11-01T00:00:00.000Z", "2026-11-10T00:00:00.000Z", 1],
    ]);
    expect(Object.keys(res)).toHaveLength(ids.length);
    expect(res["c0@group.calendar.google.com"]!.map((e) => [e.start.toISOString(), e.end.toISOString()])).toEqual([["2026-10-31T23:00:00.000Z", "2026-11-01T02:00:00.000Z"]]);
  });

  it("maps per calendar errors other than notFound and rate limits to transient errors", async () => {
    const range = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-10-02T00:00:00Z") };
    f = mockFetch({ method: "POST", url: `${G}/freeBusy`, handler: () => ({ calendars: { "jjoseph@copado.com": { errors: [{ domain: "global", reason: "internalError" }] } } }) });
    await expect(listBusy(ctx, ["jjoseph@copado.com"], range)).rejects.toBeInstanceOf(ProviderTransientError);
    f.restore();
    f = mockFetch({
      method: "POST",
      url: `${G}/freeBusy`,
      handler: () => mockResponse({ error: { code: 403, message: "Rate Limit Exceeded", errors: [{ reason: "rateLimitExceeded" }] } }, { status: 403 }),
    });
    await expect(listBusy(ctx, ["jjoseph@copado.com"], range)).rejects.toBeInstanceOf(ProviderTransientError);
  });

  it("reads a calendar that refuses events.list (access dropped to free/busy) through FreeBusy", async () => {
    f = mockFetch(
      {
        method: "GET",
        url: `${G}/calendars/jjoseph%40copado.com/events`,
        handler: () => mockResponse({ error: { code: 403, message: "You need to have reader access to this calendar.", errors: [{ reason: "requiredAccessLevel" }] } }, { status: 403 }),
      },
      { method: "POST", url: `${G}/freeBusy`, handler: () => ({ calendars: { "jjoseph@copado.com": { busy: [{ start: "2026-10-20T16:00:00Z", end: "2026-10-20T17:00:00Z" }] } } }) },
    );
    const res = await googleProvider.listEvents(ctx, ["jjoseph@copado.com"], { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") });
    expect(res["jjoseph@copado.com"]?.map((e) => [e.start.toISOString(), e.busy, e.title])).toEqual([["2026-10-20T16:00:00.000Z", true, null]]);
  });
});
