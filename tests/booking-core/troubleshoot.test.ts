// The Troubleshoot view data (SCOPE priority 4) and getBusyForUsers (GEN-08) on PGlite: every candidate start with
// its status and reasons (outside working hours, conflicting calendar event with its title, buffer before or after a
// named meeting, minimum notice, date range, daily, weekly and host meeting limits, existing bookings), for one or
// every event type, with titles only for the calendar owner.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalBusy } from "@/lib/calendars";

const cal = vi.hoisted(() => ({ busy: {} as Record<string, ExternalBusy[]>, calls: 0 }));
vi.mock("@/lib/calendars", () => ({
  getExternalBusy: async (p: { userIds: string[] }) => {
    cal.calls += 1;
    return Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: cal.busy[id] ?? [] }]));
  },
  getDestinationCalendar: async () => null,
}));
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => null,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { troubleshootAvailability } = await import("@/lib/booking/troubleshoot");
const { getBusyForUsers } = await import("@/lib/booking/availability");
const { isAppError } = await import("@/lib/errors");
const f = await import("../factories");
const { useTestDb } = await import("../helpers/db");
const h = await import("./helpers");
const { la, laTime, setupSolo, ext } = h;

const t = useTestDb();
const NOW = la("2030-10-08 08:00"); // Tuesday 08:00

beforeEach(() => {
  cal.busy = {};
  cal.calls = 0;
});

const at = (local: string) => la(local).getTime();

describe("troubleshootAvailability", () => {
  it("explains every start of the day for one event type", async () => {
    const fx = await setupSolo(t.db, {
      eventType: { slotIncrementMinutes: 30, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, minimumNoticeMinutes: 120, name: "30 Minute Virtual" },
    });
    cal.busy[fx.owner.id] = [ext(la("2030-10-08 13:00"), la("2030-10-08 14:00"), "Dentist")];
    await f.createBooking(t.db, { eventType: fx.target.eventType, start: la("2030-10-08 15:30") });
    const actor = { userId: fx.owner.id, organizationId: fx.owner.organizationId };
    const r = await troubleshootAvailability(actor, { eventTypeId: fx.target.eventType.id, start: la("2030-10-08 00:00"), end: la("2030-10-09 00:00"), now: NOW });

    expect(r.host).toMatchObject({ id: fx.owner.id, timeZone: h.LA });
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0]!;
    expect(e.eventType).toMatchObject({ name: "30 Minute Virtual", durationMinutes: 30, timeZone: h.LA, settings: { incrementMinutes: 30, minimumNoticeMinutes: 120 } });
    const byTime = new Map(e.candidates.map((c) => [laTime(c.start), c]));
    // Every half hour of the day is listed (outside hours included).
    expect(byTime.get("06:00")?.status).toBe("outside_hours");
    expect(byTime.get("20:00")?.status).toBe("outside_hours");
    expect(byTime.get("09:30")?.status).toBe("TOOSOON"); // notice until 10:00
    expect(byTime.get("10:00")?.status).toBe("available");
    // A calendar event with its title, and the buffer before it.
    expect(byTime.get("13:00")).toMatchObject({ status: "CALENDAR", blockers: [expect.objectContaining({ code: "CALENDAR", title: "Dentist", source: "calendar" })] });
    expect(byTime.get("12:30")).toMatchObject({ status: "BUFFER", blockers: [expect.objectContaining({ code: "BUFFER", title: "Dentist", bufferSide: "after" })] });
    expect(byTime.get("14:00")).toMatchObject({ status: "BUFFER", blockers: [expect.objectContaining({ bufferSide: "before" })] });
    // The existing booking of this event type.
    expect(byTime.get("15:30")?.status).toBe("EVENT");
    expect(byTime.get("15:30")?.blockers[0]).toMatchObject({
      source: "meeting",
      core: { start: at("2030-10-08 15:30"), end: at("2030-10-08 16:00") },
      title: "30 Minute Virtual",
      inviteeNames: ["Test Invitee"],
    });
    // The busy list of the host covers calendar events and meetings with titles for the owner.
    expect(r.busy.map((b) => b.title)).toEqual(["Dentist", "30 Minute Virtual"]);
    expect(r.calendar).toEqual({ status: "ok", stale: false });
  });

  it("names daily, weekly and host meeting limits and the date range", async () => {
    const fx = await setupSolo(t.db, { user: { meetingLimitDay: 3 }, eventType: { limitPerDay: 1, limitPerWeek: 2, dateRangeDays: 2 } });
    await f.createBooking(t.db, { eventType: fx.target.eventType, start: la("2030-10-08 09:00") });
    const actor = { userId: fx.owner.id, organizationId: fx.owner.organizationId };
    const day = await troubleshootAvailability(actor, { eventTypeId: fx.target.eventType.id, start: la("2030-10-08 00:00"), end: la("2030-10-09 00:00"), now: NOW });
    const c = day.entries[0]!.candidates.find((x) => x.start === at("2030-10-08 11:00"))!;
    expect(c).toMatchObject({ status: "DAILY_MAX", limitPeriods: ["day"] });
    await f.createBooking(t.db, { eventType: fx.target.eventType, start: la("2030-10-09 09:00") });
    const thu = await troubleshootAvailability(actor, { eventTypeId: fx.target.eventType.id, start: la("2030-10-10 00:00"), end: la("2030-10-11 00:00"), now: NOW });
    const w = thu.entries[0]!.candidates.find((x) => x.start === at("2030-10-10 09:00"))!;
    expect(w.reasons).toEqual(expect.arrayContaining(["WEEKLY_MAX", "RANGE"]));
    expect(w.limitPeriods).toEqual(["week"]);
    // Host-level limit across event types.
    const { eventType: other } = await f.createEventType(t.db, { owner: fx.owner, overrides: { minimumNoticeMinutes: 0, slotIncrementMinutes: 30 } });
    await f.createBooking(t.db, { eventType: other, start: la("2030-10-08 14:00") });
    await f.createBooking(t.db, { eventType: other, start: la("2030-10-08 15:00") });
    cal.calls = 0;
    const all = await troubleshootAvailability(actor, { start: la("2030-10-08 00:00"), end: la("2030-10-09 00:00"), now: NOW });
    expect(all.entries.map((e) => e.eventType.id).sort()).toEqual([fx.target.eventType.id, other.id].sort());
    const otherEntry = all.entries.find((e) => e.eventType.id === other.id)!;
    const limited = otherEntry.candidates.find((x) => x.start === at("2030-10-08 11:00"))!;
    expect(limited).toMatchObject({ status: "MEETING_LIMIT", hostLimitPeriods: ["day"] });
    expect(all.hostLimits).toEqual({ day: 3, week: null, month: null });
    expect(cal.calls).toBe(1); // one provider fetch for every event type
  });

  it("lets org admins diagnose members without titles, and nobody else", async () => {
    const fx = await setupSolo(t.db);
    cal.busy[fx.owner.id] = [ext(la("2030-10-08 10:00"), la("2030-10-08 11:00"), "Private appointment")];
    const admin = await f.createUser(t.db, { organizationId: fx.owner.organizationId, orgRole: "admin" });
    const member = await f.createUser(t.db, { organizationId: fx.owner.organizationId, orgRole: "user" });
    const stranger = await f.createUser(t.db);
    const params = { hostUserId: fx.owner.id, eventTypeId: fx.target.eventType.id, start: la("2030-10-08 00:00"), end: la("2030-10-09 00:00"), now: NOW };
    const r = await troubleshootAvailability({ userId: admin.id, organizationId: admin.organizationId, orgRole: "admin" }, params);
    const blocked = r.entries[0]!.candidates.find((c) => c.start === at("2030-10-08 10:00"))!;
    expect(blocked.status).toBe("CALENDAR");
    expect(blocked.blockers[0]!.title).toBeNull();
    expect(r.busy[0]!.title).toBeNull();
    const err1 = await troubleshootAvailability({ userId: member.id, organizationId: member.organizationId, orgRole: "user" }, params).catch((e: unknown) => e);
    expect(isAppError(err1) && err1.code).toBe("forbidden");
    const err2 = await troubleshootAvailability({ userId: stranger.id, organizationId: stranger.organizationId, orgRole: "owner" }, params).catch((e: unknown) => e);
    expect(isAppError(err2) && err2.code).toBe("forbidden");
  });

  it("refuses ranges longer than 62 days", async () => {
    const fx = await setupSolo(t.db);
    const err = await troubleshootAvailability({ userId: fx.owner.id, organizationId: fx.owner.organizationId }, { start: la("2030-10-01 00:00"), end: la("2031-01-01 00:00") }).catch((e: unknown) => e);
    expect(isAppError(err) && err.code).toBe("validation");
  });
});

describe("getBusyForUsers (GEN-08)", () => {
  it("returns external, meeting and reserved busy; titles only for the actor; other organizations are forbidden", async () => {
    const fx = await setupSolo(t.db);
    const colleague = await f.createUser(t.db, { timezone: h.LA, organizationId: fx.owner.organizationId });
    cal.busy[fx.owner.id] = [ext(la("2030-10-08 10:00"), la("2030-10-08 11:00"), "Gym")];
    cal.busy[colleague.id] = [
      ext("2030-10-09T00:00:00Z", "2030-10-10T00:00:00Z", "Vacation", { allDay: true, allDayStartDate: "2030-10-09", allDayEndDate: "2030-10-10" }),
    ];
    await f.createBooking(t.db, { eventType: fx.target.eventType, start: la("2030-10-08 12:00") });
    await f.createReservation(t.db, { eventType: fx.target.eventType, start: la("2030-10-08 14:00"), hostUserIds: [fx.owner.id], expiresAt: new Date(Date.now() + 3_600_000 * 24 * 365 * 10) });
    const actor = { userId: fx.owner.id, organizationId: fx.owner.organizationId };
    const busy = await getBusyForUsers(actor, [fx.owner.id, colleague.id], la("2030-10-08 00:00"), la("2030-10-10 00:00"));
    expect(busy[fx.owner.id]!.map((b) => [b.source, b.title ?? null])).toEqual([
      ["calendar", "Gym"],
      ["meeting", expect.stringContaining("Meeting")],
      ["reserved", null],
    ]);
    const vacation = busy[colleague.id]![0]!;
    expect(vacation.title).toBeNull();
    // All-day by calendar date in the colleague's zone (Los Angeles midnight to midnight).
    expect(new Date(vacation.start).toISOString()).toBe("2030-10-09T07:00:00.000Z");
    const stranger = await f.createUser(t.db);
    const err = await getBusyForUsers(actor, [stranger.id], la("2030-10-08 00:00"), la("2030-10-09 00:00")).catch((e: unknown) => e);
    expect(isAppError(err) && err.code).toBe("forbidden");
  });
});
