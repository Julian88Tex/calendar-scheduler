// getAvailability assembly on PGlite (ARCHITECTURE section 8): schedules (default and per event type), date-specific
// hours, holidays, external busy (timed, all-day by calendar dates, overlapping, NOCAL), app meetings with stacked
// buffers, reservations for exactly their hosts, whole-period event type limits, host meeting limits across event
// types, minimum notice, date range, increments, reschedule exclusion (SCH-24), group seats and the BK-31 window
// short circuit (no provider call).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalBusy } from "@/lib/calendars";

const cal = vi.hoisted(() => ({
  busy: {} as Record<string, ExternalBusy[]>,
  nocal: new Set<string>(),
  calls: [] as { userIds: string[]; start: Date; end: Date; maxAgeSeconds?: number }[],
}));
vi.mock("@/lib/calendars", () => ({
  getExternalBusy: async (p: { userIds: string[]; start: Date; end: Date; maxAgeSeconds?: number }) => {
    cal.calls.push(p);
    return Object.fromEntries(
      p.userIds.map((id) => [id, { ok: !cal.nocal.has(id), stale: false, nocal: cal.nocal.has(id), busy: cal.busy[id] ?? [] }]),
    );
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

const { availabilityDateOverrides, scheduledEvents, invitees } = await import("@/db/schema");
const { getAvailability } = await import("@/lib/booking/availability");
const { createBooking: seedMeeting, createEventType, createReservation, createSchedule, createUser } = await import("../factories");
const { useTestDb } = await import("../helpers/db");
const h = await import("./helpers");
const { la, setupSolo, startsOn, ext, updateEventType, updateUser, MIN, everyDay, hours } = h;

const t = useTestDb();
const NOW = la("2030-10-07 08:00"); // Monday 08:00 PDT

beforeEach(() => {
  cal.busy = {};
  cal.nocal = new Set();
  cal.calls = [];
});

const day = (date: string) => ({ start: la(`${date} 00:00`), end: la(`${date} 23:59`) });

describe("getAvailability", () => {
  it("offers the schedule's hours on the increment grid with hostsById", async () => {
    const f = await setupSolo(t.db);
    const r = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW });
    expect(startsOn(r.slots, "2030-10-08")).toEqual([
      "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
      "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
    ]);
    expect(r.hostsById[f.owner.id]?.name).toBe(f.owner.name);
    expect(cal.calls[0]?.maxAgeSeconds).toBe(180);
  });

  it("booking pages read external busy with the CALENDAR_CACHE_TTL_SECONDS cache age (CAL-10)", async () => {
    const f = await setupSolo(t.db);
    process.env.CALENDAR_CACHE_TTL_SECONDS = "300";
    try {
      await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW });
    } finally {
      delete process.env.CALENDAR_CACHE_TTL_SECONDS;
    }
    expect(cal.calls[0]?.maxAgeSeconds).toBe(300);
  });

  it("uses the event type's own schedule (Block Off Work) and date-specific hours", async () => {
    const f = await setupSolo(t.db);
    const blockOff = await createSchedule(t.db, { userId: f.owner.id, name: "Block Off Work", isDefault: false, timezone: h.LA, weeklyHours: hours("17:00", "20:00") });
    await t.db.insert(availabilityDateOverrides).values({ scheduleId: blockOff.id, date: "2030-10-09", intervals: [{ start: 18 * 60, end: 19 * 60 }] });
    await updateEventType(t.db, f.target.eventType.id, { scheduleId: blockOff.id, durationMinutes: 60 });
    const target = await f.reload();
    const r = await getAvailability({ target, start: la("2030-10-08 00:00"), end: la("2030-10-10 00:00"), now: NOW });
    expect(startsOn(r.slots, "2030-10-08")).toEqual(["17:00", "17:30", "18:00", "18:30", "19:00"]);
    expect(startsOn(r.slots, "2030-10-09")).toEqual(["18:00"]);
  });

  it("observed SCH-01 owner cases: 15/15 buffers around external busy blocks", async () => {
    const f = await setupSolo(t.db, { weeklyHours: hours("09:00", "17:00"), eventType: { slotIncrementMinutes: 15, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 } });
    // Tue Oct 8 2030: busy 12:00 to 14:45 PDT (19:00Z to 21:45Z)
    cal.busy[f.owner.id] = [ext("2030-10-08T19:00:00Z", "2030-10-08T21:45:00Z", "Lunch")];
    const r = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW });
    const starts = r.slots.map((s) => new Date(s.start).toISOString());
    expect(starts).toContain("2030-10-08T18:15:00.000Z");
    expect(starts).not.toContain("2030-10-08T18:30:00.000Z");
    expect(starts.find((s) => s > "2030-10-08T19:00:00.000Z")).toBe("2030-10-08T22:00:00.000Z");
  });

  it("all-day events block their calendar dates in the host zone, never the UTC instants (SCH-12)", async () => {
    const f = await setupSolo(t.db, { weeklyHours: hours("09:00", "20:00") });
    // A Google all-day event on Oct 9 comes back as 00:00Z to 00:00Z.
    cal.busy[f.owner.id] = [
      ext("2030-10-09T00:00:00Z", "2030-10-10T00:00:00Z", "Offsite", { allDay: true, allDayStartDate: "2030-10-09", allDayEndDate: "2030-10-10" }),
    ];
    const r = await getAvailability({ target: f.target, start: la("2030-10-08 00:00"), end: la("2030-10-11 00:00"), now: NOW });
    expect(startsOn(r.slots, "2030-10-09")).toEqual([]);
    expect(startsOn(r.slots, "2030-10-08").at(-1)).toBe("19:30"); // 00:00Z to 03:00Z of Oct 9 stays bookable
    expect(startsOn(r.slots, "2030-10-10")[0]).toBe("09:00");
  });

  it("multi-day all-day events block every covered date; overlapping and duplicate blocks from two calendars merge", async () => {
    const f = await setupSolo(t.db);
    cal.busy[f.owner.id] = [
      ext("2030-10-08T00:00:00Z", "2030-10-10T00:00:00Z", "Trip", { allDay: true, allDayStartDate: "2030-10-08", allDayEndDate: "2030-10-10" }),
      ext(la("2030-10-10 10:00"), la("2030-10-10 11:00"), "Standup", { calendarId: "work" }),
      ext(la("2030-10-10 10:30"), la("2030-10-10 12:00"), "Dentist", { calendarId: "personal" }),
      ext(la("2030-10-10 10:30"), la("2030-10-10 12:00"), "Dentist", { calendarId: "shared" }),
    ];
    const r = await getAvailability({ target: f.target, start: la("2030-10-08 00:00"), end: la("2030-10-11 00:00"), now: NOW });
    expect(startsOn(r.slots, "2030-10-08")).toEqual([]);
    expect(startsOn(r.slots, "2030-10-09")).toEqual([]);
    const thu = startsOn(r.slots, "2030-10-10");
    expect(thu).toContain("09:30");
    for (const blocked of ["10:00", "10:30", "11:00", "11:30"]) expect(thu).not.toContain(blocked);
    expect(thu).toContain("12:00");
  });

  it("a host with a broken calendar connection gets NOCAL (unavailable)", async () => {
    const f = await setupSolo(t.db);
    cal.nocal.add(f.owner.id);
    const r = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW, troubleshoot: true });
    expect(r.slots).toEqual([]);
    expect(r.diagnostics!.every((d) => d.reasons.includes("NOCAL"))).toBe(true);
  });

  it("app meetings block with their stored buffers, so buffers stack (SCH-07, SCH-11)", async () => {
    const f = await setupSolo(t.db, { eventType: { bufferBeforeMinutes: 15, bufferAfterMinutes: 15, slotIncrementMinutes: 15 } });
    await seedMeeting(t.db, { eventType: f.target.eventType, start: la("2030-10-08 10:00") });
    const r = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW });
    const starts = startsOn(r.slots, "2030-10-08");
    expect(starts).toContain("09:00");
    expect(starts).not.toContain("09:15"); // 09:15 to 09:45 + 15 after reaches the meeting's 09:45 buffer
    expect(starts).not.toContain("10:30");
    expect(starts).toContain("11:00"); // 30 minutes between meetings
  });

  it("an app meeting marked canceled frees its time", async () => {
    const f = await setupSolo(t.db);
    await seedMeeting(t.db, { eventType: f.target.eventType, start: la("2030-10-08 10:00"), status: "canceled" });
    const r = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW });
    expect(startsOn(r.slots, "2030-10-08")).toContain("10:00");
  });

  it("pending reservations block exactly their hosts until they expire (SCH-19)", async () => {
    const f = await setupSolo(t.db);
    const other = await createUser(t.db, { timezone: h.LA, organizationId: f.owner.organizationId });
    await createReservation(t.db, { eventType: f.target.eventType, start: la("2030-10-08 10:00"), hostUserIds: [f.owner.id], expiresAt: new Date(NOW.getTime() + 10 * MIN) });
    await createReservation(t.db, { eventType: f.target.eventType, start: la("2030-10-08 11:00"), hostUserIds: [f.owner.id], expiresAt: new Date(NOW.getTime() - MIN) });
    await createReservation(t.db, { eventType: f.target.eventType, start: la("2030-10-08 12:00"), hostUserIds: [other.id], expiresAt: new Date(NOW.getTime() + 10 * MIN) });
    const r = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW, troubleshoot: true });
    const starts = startsOn(r.slots, "2030-10-08");
    expect(starts).not.toContain("10:00");
    expect(starts).toContain("11:00");
    expect(starts).toContain("12:00");
    expect(r.diagnostics!.find((d) => d.start === la("2030-10-08 10:00").getTime())?.reasons).toEqual(["RESERVED"]);
  });

  it("daily limits count active meetings of the event type; canceling one restores the day (SCH-08)", async () => {
    const f = await setupSolo(t.db, { eventType: { limitPerDay: 2 } });
    const a = await seedMeeting(t.db, { eventType: f.target.eventType, start: la("2030-10-08 09:00") });
    await seedMeeting(t.db, { eventType: f.target.eventType, start: la("2030-10-08 15:00") });
    const r = await getAvailability({ target: f.target, start: la("2030-10-08 00:00"), end: la("2030-10-10 00:00"), now: NOW });
    expect(startsOn(r.slots, "2030-10-08")).toEqual([]);
    expect(startsOn(r.slots, "2030-10-09").length).toBe(16);
    await t.db.update(scheduledEvents).set({ status: "canceled" }).where(eq(scheduledEvents.id, a.scheduledEvent.id));
    const again = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW });
    expect(startsOn(again.slots, "2030-10-08").length).toBeGreaterThan(0);
  });

  it("weekly limits count whole weeks across the month edge with the owner's week start (SCH-08)", async () => {
    const f = await setupSolo(t.db, { eventType: { limitPerWeek: 1 } });
    await seedMeeting(t.db, { eventType: f.target.eventType, start: la("2030-09-29 10:00") }); // Sunday
    const now = la("2030-09-28 08:00");
    const r = await getAvailability({ target: f.target, start: la("2030-10-01 00:00"), end: la("2030-10-08 00:00"), now });
    expect(startsOn(r.slots, "2030-10-01")).toEqual([]);
    expect(startsOn(r.slots, "2030-10-04")).toEqual([]);
    expect(startsOn(r.slots, "2030-10-07").length).toBe(16);
    // With a Monday week start the Sunday meeting belongs to the previous week.
    await updateUser(t.db, f.owner.id, { weekStart: 1 });
    const monday = await getAvailability({ target: await f.reload(), start: la("2030-10-01 00:00"), end: la("2030-10-02 00:00"), now });
    expect(startsOn(monday.slots, "2030-10-01").length).toBe(16);
  });

  it("host meeting limits count meetings of every event type (SCH-09) and report MEETING_LIMIT", async () => {
    const f = await setupSolo(t.db, { user: { meetingLimitDay: 1, meetingLimitWeek: 3 } });
    const { eventType: other } = await createEventType(t.db, { owner: f.owner, durationMinutes: 60 });
    await seedMeeting(t.db, { eventType: other, start: la("2030-10-08 13:00") });
    const r = await getAvailability({ target: f.target, start: la("2030-10-08 00:00"), end: la("2030-10-10 00:00"), now: NOW, troubleshoot: true });
    expect(startsOn(r.slots, "2030-10-08")).toEqual([]);
    expect(startsOn(r.slots, "2030-10-09").length).toBe(16);
    const d = r.diagnostics!.find((x) => x.start === la("2030-10-08 09:00").getTime())!;
    expect(d.reasons).toContain("MEETING_LIMIT");
    expect(d.hosts[f.owner.id]?.limitPeriods).toEqual(["day"]);
    // Weekly: two more meetings this week fill the week.
    await seedMeeting(t.db, { eventType: other, start: la("2030-10-09 13:00") });
    await seedMeeting(t.db, { eventType: other, start: la("2030-10-10 13:00") });
    const week = await getAvailability({ target: f.target, start: la("2030-10-11 00:00"), end: la("2030-10-12 00:00"), now: NOW, troubleshoot: true });
    expect(week.slots).toEqual([]);
    expect(week.diagnostics!.find((x) => x.start === la("2030-10-11 09:00").getTime())!.hosts[f.owner.id]?.limitPeriods).toEqual(["week"]);
  });

  it("minimum notice and the rolling date range bound the starts (SCH-02, SCH-06)", async () => {
    const f = await setupSolo(t.db, { eventType: { minimumNoticeMinutes: 240, dateRangeDays: 7 } });
    const r = await getAvailability({ target: f.target, start: la("2030-10-07 00:00"), end: la("2030-10-16 00:00"), now: la("2030-10-07 08:07") });
    expect(startsOn(r.slots, "2030-10-07")[0]).toBe("12:30"); // first increment at or after 12:07
    expect(startsOn(r.slots, "2030-10-11").length).toBe(16);
    expect(startsOn(r.slots, "2030-10-14")).toEqual([]); // window ends Oct 14 08:07
    expect(r.windowEnd).toBe(la("2030-10-14 08:07").getTime() + 1);
  });

  it("start increments are independent of the duration (SCH-10)", async () => {
    const f = await setupSolo(t.db, { eventType: { slotIncrementMinutes: 15 } });
    const r = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW, durationMinutes: 30 });
    const starts = startsOn(r.slots, "2030-10-08");
    expect(starts.slice(0, 3)).toEqual(["09:00", "09:15", "09:30"]);
    expect(starts.at(-1)).toBe("16:30");
  });

  it("observed holidays block the date (users.holiday_country)", async () => {
    const f = await setupSolo(t.db, { user: { holidayCountry: "US" } });
    const r = await getAvailability({ target: f.target, start: la("2030-11-27 00:00"), end: la("2030-11-30 00:00"), now: NOW });
    expect(startsOn(r.slots, "2030-11-28")).toEqual([]); // Thanksgiving
    expect(startsOn(r.slots, "2030-11-27").length).toBe(16);
  });

  it("reschedule evaluation excludes the moved meeting from busy and limits (SCH-24)", async () => {
    const f = await setupSolo(t.db, { eventType: { limitPerDay: 1 } });
    const m = await seedMeeting(t.db, { eventType: f.target.eventType, start: la("2030-10-08 10:00") });
    const before = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW });
    expect(startsOn(before.slots, "2030-10-08")).toEqual([]);
    const r = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW, ignoreInviteeId: m.invitee!.id });
    const starts = startsOn(r.slots, "2030-10-08");
    expect(starts).toContain("10:00");
    expect(starts).toContain("16:30");
  });

  it("answers a range outside the booking window without loading busy times (BK-31)", async () => {
    const f = await setupSolo(t.db, { eventType: { dateRangeDays: 30 } });
    const r = await getAvailability({ target: f.target, start: la("2031-01-01 00:00"), end: la("2031-02-01 00:00"), now: NOW });
    expect(r.slots).toEqual([]);
    expect(cal.calls).toHaveLength(0);
    const past = await getAvailability({ target: f.target, start: la("2030-09-01 00:00"), end: la("2030-10-01 00:00"), now: NOW });
    expect(past.slots).toEqual([]);
    expect(cal.calls).toHaveLength(0);
    await getAvailability({ target: f.target, start: la("2030-10-01 00:00"), end: la("2030-11-01 00:00"), now: NOW });
    expect(cal.calls).toHaveLength(1);
  });

  it("an event type that is deleted offers nothing", async () => {
    const f = await setupSolo(t.db);
    const r = await getAvailability({ target: { ...f.target, eventType: { ...f.target.eventType, deletedAt: new Date() } }, ...day("2030-10-08"), now: NOW });
    expect(r.slots).toEqual([]);
  });

  it("free/busy exceptions ignore matching calendar events (SCH-13)", async () => {
    const f = await setupSolo(t.db, { eventType: { freeBusyExceptions: [{ mode: "includes", text: "focus" }] } });
    cal.busy[f.owner.id] = [ext(la("2030-10-08 10:00"), la("2030-10-08 12:00"), "Focus time")];
    const r = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW });
    expect(startsOn(r.slots, "2030-10-08")).toContain("10:00");
  });
});

describe("group seats (SCH-14)", () => {
  it("holds take a seat, full slots disappear, off-grid slots stay joinable and other event types see the slot as busy", async () => {
    const f = await setupSolo(t.db, { eventType: { kind: "group", maxInvitees: 3, slotIncrementMinutes: 60 } });
    // Existing slot at 09:30 (off the 60 minute grid) with 2 invitees.
    await seedMeeting(t.db, { eventType: f.target.eventType, start: la("2030-10-08 09:30"), invitees: [{}, {}] });
    const r = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW });
    const slot = r.slots.find((s) => s.start === la("2030-10-08 09:30").getTime());
    expect(slot?.inviteesRemaining).toBe(1);
    expect(slot?.existingMeetingId).toBeTruthy();
    // A pending payment hold for the last seat fills the slot.
    await createReservation(t.db, { eventType: f.target.eventType, start: la("2030-10-08 09:30"), hostUserIds: [f.owner.id], expiresAt: new Date(NOW.getTime() + 10 * MIN) });
    const full = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW });
    expect(full.slots.find((s) => s.start === la("2030-10-08 09:30").getTime())).toBeUndefined();
    // Another event type of the host cannot use that time.
    const { eventType: solo } = await createEventType(t.db, { owner: f.owner, durationMinutes: 30, overrides: { slotIncrementMinutes: 30, minimumNoticeMinutes: 0 } });
    const { loadEventType } = await import("@/lib/booking/target");
    const other = await getAvailability({ target: { kind: "event_type", eventType: (await loadEventType(solo.id))! }, ...day("2030-10-08"), now: NOW });
    expect(startsOn(other.slots, "2030-10-08")).not.toContain("09:30");
  });

  it("a group reschedule frees only the invitee's own seat", async () => {
    const f = await setupSolo(t.db, { eventType: { kind: "group", maxInvitees: 2, slotIncrementMinutes: 60 } });
    const m = await seedMeeting(t.db, { eventType: f.target.eventType, start: la("2030-10-08 10:00"), invitees: [{}, {}] });
    const full = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW });
    expect(full.slots.find((s) => s.start === la("2030-10-08 10:00").getTime())).toBeUndefined();
    const own = await getAvailability({ target: f.target, ...day("2030-10-08"), now: NOW, ignoreInviteeId: m.invitees[0]!.id });
    expect(own.slots.find((s) => s.start === la("2030-10-08 10:00").getTime())?.inviteesRemaining).toBe(1);
    const inv = await t.db.select().from(invitees).where(eq(invitees.scheduledEventId, m.scheduledEvent.id));
    expect(inv).toHaveLength(2);
  });
});

describe("round robin", () => {
  it("a pending hold on host A leaves host B bookable at the same time (SCH-19)", async () => {
    const a = await createUser(t.db, { timezone: h.LA });
    const b = await createUser(t.db, { timezone: h.LA, organizationId: a.organizationId });
    await createSchedule(t.db, { userId: a.id, timezone: h.LA, weeklyHours: everyDay("09:00", "17:00") });
    await createSchedule(t.db, { userId: b.id, timezone: h.LA, weeklyHours: everyDay("09:00", "17:00") });
    const { eventType } = await createEventType(t.db, {
      owner: a,
      poolingType: "round_robin",
      hosts: [{ userId: a.id }, { userId: b.id }],
      overrides: { minimumNoticeMinutes: 0, slotIncrementMinutes: 30 },
    });
    const { loadEventType } = await import("@/lib/booking/target");
    const target = { kind: "event_type" as const, eventType: (await loadEventType(eventType.id))! };
    await createReservation(t.db, { eventType, start: la("2030-10-08 10:00"), hostUserIds: [a.id], expiresAt: new Date(NOW.getTime() + 10 * MIN) });
    const r = await getAvailability({ target, ...day("2030-10-08"), now: NOW });
    const slot = r.slots.find((s) => s.start === la("2030-10-08 10:00").getTime());
    expect(slot?.eligibleHostIds).toEqual([b.id]);
    expect(slot?.inviteesRemaining).toBe(1);
  });
});
