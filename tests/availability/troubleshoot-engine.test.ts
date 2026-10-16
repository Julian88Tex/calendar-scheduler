// The Troubleshoot view end to end on PGlite (docs/SCOPE.md priority 4): the page data from getTroubleshootDay with
// booking-core's real troubleshootAvailability and slot engine, read through the view copy. Only the unfinished
// modules' contracts are mocked (calendars busy feed, links, polls, the event registry).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalBusy } from "@/lib/calendars";

const cal = vi.hoisted(() => ({ busy: {} as Record<string, ExternalBusy[]> }));
vi.mock("@/lib/calendars", () => ({
  getExternalBusy: async (p: { userIds: string[] }) =>
    Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: cal.busy[id] ?? [] }])),
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

const { setFakeNow, resetFakeTime } = await import("@/lib/time/now");
const { getTroubleshootDay } = await import("@/lib/availability/troubleshoot");
const { setMeetingLimits } = await import("@/lib/availability");
const { describeCandidate } = await import("@/lib/availability/troubleshoot-view");
const { createBooking, createEventType, createSchedule, createUser } = await import("../factories");
const { useTestDb } = await import("../helpers/db");

const t = useTestDb();
const LA = "America/Los_Angeles";
const h = (hh: number) => hh * 60;
const WEEKDAYS = [[], [{ start: h(9), end: h(17) }], [{ start: h(9), end: h(17) }], [{ start: h(9), end: h(17) }], [{ start: h(9), end: h(17) }], [{ start: h(9), end: h(17) }], []];
/** 2030-10-08 (a Tuesday) hh:mm in Los Angeles (PDT, UTC-7). */
const at = (hh: number, mm = 0) => new Date(Date.UTC(2030, 9, 8, hh + 7, mm));

beforeEach(() => {
  cal.busy = {};
  resetFakeTime();
});

async function scenario() {
  const user = await createUser(t.db, { timezone: LA });
  const schedule = await createSchedule(t.db, { userId: user.id, timezone: LA, weeklyHours: WEEKDAYS as never });
  const { eventType } = await createEventType(t.db, {
    owner: user,
    name: "30 Minute Virtual",
    durationMinutes: 30,
    overrides: {
      scheduleId: schedule.id,
      slotIncrementMinutes: 15,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      minimumNoticeMinutes: 240,
      dateRangeType: "rolling",
      dateRangeDays: 60,
    },
  });
  const other = (await createEventType(t.db, { owner: user, name: "In-Person Meal or Coffee", durationMinutes: 30, overrides: { scheduleId: schedule.id } })).eventType;
  cal.busy[user.id] = [
    { start: at(13), end: at(14), allDay: false, title: "Dentist", calendarId: "cal-1", externalId: "ext-1" },
  ];
  await createBooking(t.db, { eventType: other, start: at(15), invitee: { name: "Maya Patel", email: "maya@example.com" } });
  return { user, schedule, eventType, actor: { orgId: user.organizationId, orgRole: user.orgRole, user } };
}

describe("Troubleshoot end to end", () => {
  it("explains every start of the day with the blocking event names", async () => {
    const f = await scenario();
    setFakeNow(at(7, 59));
    const day = await getTroubleshootDay(f.actor, { date: "2030-10-08", eventTypeId: f.eventType.id });
    expect(day.error).toBeNull();
    const entry = day.result!.entries[0]!;
    expect(entry.eventType.name).toBe("30 Minute Virtual");
    const ctx = {
      zone: day.zone,
      hour12: true,
      eventTypeName: entry.eventType.name,
      durationMinutes: entry.eventType.durationMinutes,
      settings: entry.eventType.settings,
      hostLimits: day.hostLimits,
      scheduleName: "Working hours",
    };
    const views = new Map(entry.candidates.map((c) => [describeCandidate(c, ctx).timeLabel, describeCandidate(c, ctx)]));
    // Before 9:00: outside working hours.
    expect(views.get("8:00am")?.status).toBe("outside_hours");
    expect(views.get("8:00am")?.reasons[0]).toBe('Outside your working hours (schedule "Working hours").');
    // 4 hours of notice at 7:59am: starts before 11:59am are too soon.
    expect(views.get("11:45am")?.status).toBe("TOOSOON");
    expect(views.get("11:45am")?.chip).toBe("TOO SOON");
    expect(views.get("11:45am")?.reasons).toContain("Too soon: invitees must schedule at least 4 hours in advance.");
    expect(views.get("12:00pm")?.status).toBe("available");
    // Dentist 1:00pm to 2:00pm on the calendar, 15/15 buffers.
    expect(views.get("12:30pm")?.status).toBe("BUFFER");
    expect(views.get("12:30pm")?.reasons).toContain('Your 15 min buffer after this time overlaps "Dentist" (1:00pm - 2:00pm).');
    expect(views.get("1:00pm")?.status).toBe("CALENDAR");
    expect(views.get("1:00pm")?.reasons).toContain('Conflicts with "Dentist" on your calendar (1:00pm - 2:00pm).');
    expect(views.get("2:00pm")?.status).toBe("BUFFER");
    expect(views.get("2:00pm")?.reasons).toContain('Your 15 min buffer before this time overlaps "Dentist" (1:00pm - 2:00pm).');
    expect(views.get("2:15pm")?.status).toBe("available");
    // Another meeting at 3:00pm.
    expect(views.get("2:30pm")?.status).toBe("BUFFER");
    expect(views.get("3:00pm")?.status).toBe("OVERLAP");
    expect(views.get("3:00pm")?.reasons).toContain('Overlaps another meeting: "In-Person Meal or Coffee" with Maya Patel (3:00pm - 3:30pm).');
    // 4:45pm would end after 5:00pm; from 5:00pm on, outside working hours again.
    expect(views.get("4:30pm")?.status).toBe("available");
    expect(views.get("4:45pm")?.status).toBe("DURATION");
    expect(views.get("4:45pm")?.reasons).toEqual(["Not enough time: the meeting (30 min) would run past the end of your available hours."]);
    expect(views.get("5:00pm")?.status).toBe("outside_hours");
    // The day summary lists the busy times with titles.
    expect(day.result!.busy.map((b) => b.title)).toEqual(expect.arrayContaining(["Dentist", "In-Person Meal or Coffee"]));
  });

  it("reports the host meeting limit across event types", async () => {
    const f = await scenario();
    setFakeNow(at(7, 59));
    await setMeetingLimits(t.db, f.user.id, { day: 1, week: null, month: null });
    const day = await getTroubleshootDay(f.actor, { date: "2030-10-08", eventTypeId: f.eventType.id });
    const entry = day.result!.entries[0]!;
    const ctx = {
      zone: day.zone,
      hour12: true,
      eventTypeName: entry.eventType.name,
      durationMinutes: entry.eventType.durationMinutes,
      settings: entry.eventType.settings,
      hostLimits: day.hostLimits,
    };
    const noon = entry.candidates.map((c) => describeCandidate(c, ctx)).find((v) => v.timeLabel === "12:00pm");
    expect(noon?.status).toBe("MEETING_LIMIT");
    expect(noon?.reasons).toContain("Meeting limit reached: you allow 1 meeting per day across all event types.");
    expect(day.hostCounts?.day).toBe(1);
  });
});
