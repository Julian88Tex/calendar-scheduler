// Availability input schemas (SPEC AV-02, AV-04, AV-06, AV-14).
import { describe, expect, it } from "vitest";
import { END_BEFORE_START_MESSAGE, OVERLAP_MESSAGE } from "./intervals";
import {
  CreateScheduleInput,
  limitRows,
  MeetingLimitsInput,
  rowsToLimits,
  UpsertOverridesInput,
  WeeklyHoursInput,
  zDayIntervalsInput,
  zScheduleName,
} from "./schemas";

const ID = "8f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
const h = (hh: number, mm = 0) => hh * 60 + mm;

describe("schedule names (AV-02)", () => {
  it("trims and accepts 1 to 60 characters", () => {
    expect(zScheduleName.parse("  Block Off Work  ")).toBe("Block Off Work");
    expect(zScheduleName.safeParse("").success).toBe(false);
    expect(zScheduleName.safeParse("   ").error?.issues[0]?.message).toBe("Enter a schedule name.");
    expect(zScheduleName.safeParse("x".repeat(61)).error?.issues[0]?.message).toBe("Use 60 characters or fewer.");
    expect(CreateScheduleInput.parse({ name: "x".repeat(60) }).name).toHaveLength(60);
  });
});

describe("day intervals (AV-04)", () => {
  it("rejects overlapping intervals with the Calendly message", () => {
    const res = zDayIntervalsInput.safeParse([
      { start: h(9), end: h(12) },
      { start: h(11), end: h(13) },
    ]);
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(OVERLAP_MESSAGE);
    expect(res.error?.issues[0]?.path).toEqual([1, "start"]);
  });

  it("rejects inverted and zero-length intervals", () => {
    const res = zDayIntervalsInput.safeParse([{ start: h(17), end: h(9) }]);
    expect(res.error?.issues[0]?.message).toBe(END_BEFORE_START_MESSAGE);
    expect(res.error?.issues[0]?.path).toEqual([0, "end"]);
    expect(zDayIntervalsInput.safeParse([{ start: h(17), end: h(17) }]).success).toBe(false);
  });

  it("accepts touching intervals and sorts them", () => {
    expect(
      zDayIntervalsInput.parse([
        { start: h(12), end: h(17) },
        { start: h(9), end: h(12) },
      ]),
    ).toEqual([
      { start: h(9), end: h(12) },
      { start: h(12), end: h(17) },
    ]);
  });

  it("accepts any minute and midnight as an end", () => {
    expect(zDayIntervalsInput.parse([{ start: 785, end: 1440 }])).toEqual([{ start: 785, end: 1440 }]);
    expect(zDayIntervalsInput.safeParse([{ start: 0, end: 1441 }]).success).toBe(false);
    expect(zDayIntervalsInput.safeParse([{ start: 9.5, end: 600 }]).success).toBe(false);
  });

  it("validates weekly hours as seven days", () => {
    const week = [[], [{ start: h(9), end: h(17) }], [], [], [], [], []];
    expect(WeeklyHoursInput.safeParse({ scheduleId: ID, weeklyHours: week }).success).toBe(true);
    expect(WeeklyHoursInput.safeParse({ scheduleId: ID, weeklyHours: week.slice(0, 6) }).success).toBe(false);
    expect(WeeklyHoursInput.safeParse({ scheduleId: "nope", weeklyHours: week }).success).toBe(false);
  });
});

describe("date-specific hours input (AV-06)", () => {
  it("requires valid dates and accepts empty intervals (unavailable)", () => {
    expect(UpsertOverridesInput.safeParse({ scheduleId: ID, dates: ["2026-10-22"], intervals: [] }).success).toBe(true);
    expect(UpsertOverridesInput.safeParse({ scheduleId: ID, dates: [], intervals: [] }).error?.issues[0]?.message).toBe("Select at least one date.");
    expect(UpsertOverridesInput.safeParse({ scheduleId: ID, dates: ["2026-02-30"], intervals: [] }).success).toBe(false);
  });
});

describe("meeting limits (AV-14)", () => {
  it("accepts 1 to 999 or null per period", () => {
    expect(MeetingLimitsInput.parse({ day: 3, week: null, month: 40 })).toEqual({ day: 3, week: null, month: 40 });
    expect(MeetingLimitsInput.safeParse({ day: 0, week: null, month: null }).success).toBe(false);
    expect(MeetingLimitsInput.safeParse({ day: 1000, week: null, month: null }).success).toBe(false);
    expect(MeetingLimitsInput.safeParse({ day: 2.5, week: null, month: null }).success).toBe(false);
  });

  it("maps limits to rows and back", () => {
    expect(limitRows({ day: 3, week: null, month: 40 })).toEqual([
      { period: "day", count: 3 },
      { period: "month", count: 40 },
    ]);
    expect(rowsToLimits([{ period: "week", count: 5 }, { period: "week", count: 9 }, { period: "day", count: null }])).toEqual({
      day: null,
      week: 5,
      month: null,
    });
  });
});
