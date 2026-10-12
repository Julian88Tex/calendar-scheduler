// loadScheduleInput (ARCHITECTURE section 8 step 1; SPEC AV-06, AV-08, AV-13) and host meeting limits (AV-14,
// SCH-09) on PGlite: overrides inside the range plus a one day margin, holidays (beat overrides, with observed and
// substitute days by key), the schedule zone, and limits with their period counts.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { userHolidayOverrides, users } from "@/db/schema";
import {
  countHostMeetings,
  getMeetingLimits,
  loadScheduleInput,
  periodBounds,
  setMeetingLimits,
  upsertDateOverrides,
} from "@/lib/availability";
import { computeSlots } from "@/lib/slots";
import { createBooking, createEventType, createSchedule, createUser } from "../factories";
import { useTestDb } from "../helpers/db";

const t = useTestDb();
const h = (hh: number) => hh * 60;
const NINE_FIVE = [{ start: h(9), end: h(17) }];
const EVERY_DAY = [NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE] as const;

async function setup(timezone = "America/New_York") {
  const user = await createUser(t.db, { timezone });
  const schedule = await createSchedule(t.db, { userId: user.id, timezone, weeklyHours: [...EVERY_DAY] as never });
  return { user, schedule };
}

describe("loadScheduleInput", () => {
  it("returns weekly hours, the zone and overrides in range plus one day on each side", async () => {
    const { user, schedule } = await setup();
    for (const date of ["2030-10-20", "2030-10-21", "2030-10-25", "2030-10-26", "2030-10-27"]) {
      await upsertDateOverrides(t.db, user.id, schedule.id, { dates: [date], intervals: date === "2030-10-25" ? [] : [{ start: h(10), end: h(11) }] });
    }
    const input = await loadScheduleInput(schedule.id, { start: new Date("2030-10-22T12:00:00Z"), end: new Date("2030-10-25T12:00:00Z") });
    expect(input?.timeZone).toBe("America/New_York");
    expect(input?.weekly[1]).toEqual(NINE_FIVE);
    expect(Object.keys(input?.overrides ?? {}).sort()).toEqual(["2030-10-21", "2030-10-25", "2030-10-26"]);
    expect(input?.overrides["2030-10-25"]).toEqual([]);
    expect(input?.blockedDates).toEqual([]);
  });

  it("returns null for deleted or unknown schedules", async () => {
    const { schedule } = await setup();
    expect(await loadScheduleInput("00000000-0000-4000-8000-000000000000", { start: new Date(), end: new Date() })).toBeNull();
    await t.db.update((await import("@/db/schema")).availabilitySchedules).set({ deletedAt: new Date() }).where(eq((await import("@/db/schema")).availabilitySchedules.id, schedule.id));
    expect(await loadScheduleInput(schedule.id, { start: new Date(), end: new Date() })).toBeNull();
  });

  it("blocks observed holidays (they beat date-specific hours) and follows the On/Off overrides", async () => {
    const { user, schedule } = await setup("America/Chicago");
    await t.db.update(users).set({ holidayCountry: "US" }).where(eq(users.id, user.id));
    // Thanksgiving 2026 is Thursday November 26; a date-specific override on it does not reopen it.
    await upsertDateOverrides(t.db, user.id, schedule.id, { dates: ["2026-11-26"], intervals: NINE_FIVE });
    const range = { start: new Date("2026-11-20T12:00:00Z"), end: new Date("2026-11-30T12:00:00Z") };
    let input = await loadScheduleInput(schedule.id, range);
    expect(input?.blockedDates).toContain("2026-11-26");

    const slotsFor = (i: NonNullable<typeof input>) =>
      computeSlots({
        rules: {
          eventTypeId: "et",
          durationMinutes: 30,
          incrementMinutes: 60,
          alignment: "interval_start",
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          minimumNoticeMinutes: 0,
          dateRange: { type: "unlimited" },
          rangeZone: i.timeZone,
          weekStart: 0,
          limits: {},
          eventTypeMeetingStarts: [],
          kind: "solo",
          seats: 1,
          groupSlots: [],
          pooling: null,
          pools: [],
          freeBusyExceptions: [],
        },
        hosts: [
          {
            userId: user.id,
            schedule: i,
            busy: [],
            calendarStatus: "ok",
            hostLimits: {},
            hostLimitZone: i.timeZone,
            hostMeetingStarts: [],
            priority: 3,
            poolId: null,
            rr: null,
          },
        ],
        query: { rangeStart: Date.parse("2026-11-26T06:00:00Z"), rangeEnd: Date.parse("2026-11-27T06:00:00Z"), now: Date.parse("2026-01-01T00:00:00Z") },
      }).slots;
    expect(slotsFor(input!)).toEqual([]);

    // Turning Thanksgiving Off restores the date (the date-specific hours apply again).
    await t.db.insert(userHolidayOverrides).values({ userId: user.id, holidayKey: "US:4th_thursday_in_november", observed: false });
    input = await loadScheduleInput(schedule.id, range);
    expect(input?.blockedDates).not.toContain("2026-11-26");
    expect(slotsFor(input!).length).toBe(8);
  });

  it("changing the schedule zone keeps wall-clock hours (UTC slots move)", async () => {
    const { user, schedule } = await setup("America/New_York");
    const { updateScheduleTimezone } = await import("@/lib/availability");
    await updateScheduleTimezone(t.db, user.id, schedule.id, "America/Los_Angeles");
    const input = await loadScheduleInput(schedule.id, { start: new Date("2030-10-22T00:00:00Z"), end: new Date("2030-10-23T00:00:00Z") });
    expect(input?.timeZone).toBe("America/Los_Angeles");
    expect(input?.weekly[2]).toEqual(NINE_FIVE);
  });
});

describe("host meeting limits (AV-14)", () => {
  it("persists limits and validates them", async () => {
    const { user } = await setup();
    expect(await getMeetingLimits(user.id)).toEqual({ day: null, week: null, month: null });
    await setMeetingLimits(t.db, user.id, { day: 3, week: 10, month: null });
    expect(await getMeetingLimits(user.id)).toEqual({ day: 3, week: 10, month: null });
    const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect([row?.meetingLimitDay, row?.meetingLimitWeek, row?.meetingLimitMonth]).toEqual([3, 10, null]);
    await expect(setMeetingLimits(t.db, user.id, { day: 0, week: null, month: null })).rejects.toMatchObject({ code: "validation" });
    await expect(setMeetingLimits(t.db, user.id, { day: 1000, week: null, month: null })).rejects.toMatchObject({ code: "validation" });
  });

  it("computes day, week (week start) and month bounds in the zone", () => {
    const b = periodBounds("2030-10-23", "America/New_York", 0);
    expect(b.day.start.toISOString()).toBe("2030-10-23T04:00:00.000Z");
    expect(b.day.end.toISOString()).toBe("2030-10-24T04:00:00.000Z");
    expect(b.week.start.toISOString()).toBe("2030-10-20T04:00:00.000Z"); // Sunday
    expect(b.week.end.toISOString()).toBe("2030-10-27T04:00:00.000Z");
    expect(periodBounds("2030-10-23", "America/New_York", 1).week.start.toISOString()).toBe("2030-10-21T04:00:00.000Z"); // Monday
    expect(b.month.start.toISOString()).toBe("2030-10-01T04:00:00.000Z");
    expect(b.month.end.toISOString()).toBe("2030-11-01T04:00:00.000Z");
  });

  it("counts active meetings of every event type by start in the default schedule zone", async () => {
    const { user } = await setup("America/New_York");
    const a = (await createEventType(t.db, { owner: user })).eventType;
    const b = (await createEventType(t.db, { owner: user })).eventType;
    await createBooking(t.db, { eventType: a, start: "2030-10-23T14:00:00Z" }); // Wed
    await createBooking(t.db, { eventType: b, start: "2030-10-23T16:00:00Z" }); // Wed
    await createBooking(t.db, { eventType: b, start: "2030-10-24T03:30:00Z" }); // Wed 23:30 local
    await createBooking(t.db, { eventType: a, start: "2030-10-21T14:00:00Z" }); // Mon same week
    await createBooking(t.db, { eventType: a, start: "2030-10-02T14:00:00Z" }); // same month
    await createBooking(t.db, { eventType: a, start: "2030-10-23T18:00:00Z", status: "canceled" });
    const counts = await countHostMeetings(user.id, "2030-10-23");
    expect(counts).toMatchObject({ day: 3, week: 4, month: 5, zone: "America/New_York", weekStart: 0 });
  });
});
