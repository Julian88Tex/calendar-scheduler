// Pure editor helpers (SPEC AV-03 to AV-07, ET-19).
import { describe, expect, it } from "vitest";
import type { WeeklyHours } from "@/db/types";
import { parseTimeInput } from "@/components/ui/time-input-utils";
import {
  applyOverrideChange,
  copyDayTo,
  dayIsValid,
  dayOrder,
  effectiveHours,
  END_BEFORE_START_MESSAGE,
  formatDayIntervals,
  formatInterval,
  formatOverrideDate,
  intervalErrors,
  isIsoDate,
  nextInterval,
  OVERLAP_MESSAGE,
  partitionOverrides,
  settleDay,
  sortWeekly,
  weeklyIsValid,
  weeklySummary,
} from "./intervals";

const h = (hh: number, mm = 0) => hh * 60 + mm;
const r = (a: number, b: number) => ({ start: a, end: b });
const NINE_FIVE = [r(h(9), h(17))];
const WEEKDAYS: WeeklyHours = [[], NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, []];

describe("interval validation (AV-04)", () => {
  it("flags an end that is not later than the start", () => {
    expect(intervalErrors([r(h(10), h(9))])).toEqual([END_BEFORE_START_MESSAGE]);
    expect(intervalErrors([r(h(10), h(10))])).toEqual([END_BEFORE_START_MESSAGE]);
  });

  it("flags the later interval of an overlapping pair", () => {
    expect(intervalErrors([r(h(9), h(12)), r(h(11), h(14))])).toEqual([null, OVERLAP_MESSAGE]);
    expect(intervalErrors([r(h(9), h(17)), r(h(9), h(17))])).toEqual([null, OVERLAP_MESSAGE]);
  });

  it("allows touching intervals and keeps them as separate rows", () => {
    const day = [r(h(12), h(17)), r(h(9), h(12))];
    expect(intervalErrors(day)).toEqual([null, null]);
    expect(dayIsValid(day)).toBe(true);
    expect(settleDay(day)).toEqual([r(h(9), h(12)), r(h(12), h(17))]);
  });

  it("treats 12:00am as an end time as midnight (1440)", () => {
    expect(dayIsValid([r(h(22), 1440)])).toBe(true);
    expect(formatInterval(r(h(22), 1440))).toBe("10:00pm - 12:00am");
  });

  it("keeps invalid days as typed (no re-sort under an error)", () => {
    const day = [r(h(14), h(13)), r(h(9), h(10))];
    expect(settleDay(day)).toEqual(day);
  });

  it("typing 1:05pm stores 785 minutes and the row re-sorts", () => {
    const minutes = parseTimeInput("1:05pm");
    expect(minutes).toBe(785);
    const day = settleDay([r(h(15), h(16)), r(minutes!, h(14))]);
    expect(day).toEqual([r(785, h(14)), r(h(15), h(16))]);
  });

  it("validates whole weeks", () => {
    expect(weeklyIsValid(WEEKDAYS)).toBe(true);
    const bad = sortWeekly(WEEKDAYS);
    bad[3] = [r(h(9), h(12)), r(h(11), h(13))];
    expect(weeklyIsValid(bad)).toBe(false);
  });
});

describe("adding intervals (AV-03)", () => {
  it("adds 9:00am to 5:00pm to an unavailable day", () => {
    expect(nextInterval([])).toEqual(r(h(9), h(17)));
  });

  it("adds one hour, one hour after the last end", () => {
    expect(nextInterval([r(h(9), h(17))])).toEqual(r(h(18), h(19)));
  });

  it("caps at midnight", () => {
    expect(nextInterval([r(h(9), h(23))])).toEqual(r(h(23, 45), 1440));
  });

  it("falls back to the first free gap, and null when the day is full", () => {
    expect(nextInterval([r(h(1), 1440)])).toEqual(r(0, h(1)));
    expect(nextInterval([r(0, 1440)])).toBeNull();
  });
});

describe("copy times (AV-05)", () => {
  it("copies Monday 9 to 5 to Tuesday through Friday, replacing their intervals", () => {
    const week: WeeklyHours = [[], [r(h(9), h(17))], [r(h(8), h(9))], [], [r(h(13), h(14))], [], []];
    const next = copyDayTo(week, 1, [2, 3, 4, 5]);
    for (const d of [1, 2, 3, 4, 5]) expect(next[d]).toEqual([r(h(9), h(17))]);
    expect(next[0]).toEqual([]);
    expect(next[6]).toEqual([]);
    // deep copy
    next[2]![0]!.start = 0;
    expect(next[1]![0]!.start).toBe(h(9));
    expect(week[2]).toEqual([r(h(8), h(9))]);
  });
});

describe("display helpers", () => {
  it("orders days by week start", () => {
    expect(dayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(dayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("summarizes weekly hours (ET-19)", () => {
    expect(weeklySummary(WEEKDAYS)).toBe("Weekdays, 9 am - 5 pm");
    expect(weeklySummary([NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE])).toBe("Every day, 9 am - 5 pm");
    expect(weeklySummary([[r(h(9, 30), h(12))], [], [], [], [], [], [r(h(9, 30), h(12))]])).toBe("Weekends, 9:30 am - 12 pm");
    expect(weeklySummary([[], [r(h(9), h(12))], [], [r(h(9), h(12))], [], [], []])).toBe("Mon, Wed, 9 am - 12 pm");
    expect(weeklySummary([[], NINE_FIVE, [r(h(10), h(17))], [], [], [], []])).toBe("Hours vary");
    expect(weeklySummary([[], [], [], [], [], [], []])).toBe("No weekly hours");
    expect(weeklySummary(WEEKDAYS, false)).toBe("Weekdays, 09:00 - 17:00");
  });

  it("formats day intervals and the unavailable state", () => {
    expect(formatDayIntervals([r(h(13), h(17)), r(h(9), h(12))])).toBe("9:00am - 12:00pm, 1:00pm - 5:00pm");
    expect(formatDayIntervals([])).toBe("Unavailable");
    expect(formatDayIntervals([r(h(17), h(17))])).toBe("Unavailable");
  });

  it("formats override dates like Calendly", () => {
    expect(formatOverrideDate("2026-10-22")).toBe("Thu, Oct 22, 2026");
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
  });
});

describe("date-specific hours (AV-06)", () => {
  const list = [
    { date: "2026-10-01", intervals: [] },
    { date: "2026-10-22", intervals: [r(h(10), h(14))] },
    { date: "2026-10-12", intervals: [r(h(9), h(10))] },
  ];

  it("splits upcoming (sorted) and past (most recent first) dates", () => {
    const { upcoming, past } = partitionOverrides(list, "2026-10-12");
    expect(upcoming.map((o) => o.date)).toEqual(["2026-10-12", "2026-10-22"]);
    expect(past.map((o) => o.date)).toEqual(["2026-10-01"]);
  });

  it("applies upserts (replacing each date entirely) and deletes", () => {
    const next = applyOverrideChange(list, { type: "upsert", dates: ["2026-10-22", "2026-10-23"], intervals: [r(h(15), h(16)), r(h(8), h(9))] });
    expect(next.find((o) => o.date === "2026-10-22")?.intervals).toEqual([r(h(8), h(9)), r(h(15), h(16))]);
    expect(next.find((o) => o.date === "2026-10-23")?.intervals).toEqual([r(h(8), h(9)), r(h(15), h(16))]);
    expect(next.map((o) => o.date)).toEqual(["2026-10-01", "2026-10-12", "2026-10-22", "2026-10-23"]);
    expect(applyOverrideChange(next, { type: "delete", date: "2026-10-01" }).map((o) => o.date)).toEqual(["2026-10-12", "2026-10-22", "2026-10-23"]);
  });

  it("an override replaces the weekday hours; an empty one means unavailable", () => {
    const map = new Map(list.map((o) => [o.date, o.intervals]));
    expect(effectiveHours(WEEKDAYS, map, "2026-10-22")).toEqual({ intervals: [r(h(10), h(14))], source: "override" });
    expect(effectiveHours(WEEKDAYS, map, "2026-10-01")).toEqual({ intervals: [], source: "override" });
    expect(effectiveHours(WEEKDAYS, map, "2026-10-20")).toEqual({ intervals: NINE_FIVE, source: "weekly" });
    expect(effectiveHours(WEEKDAYS, {}, "2026-10-18")).toEqual({ intervals: [], source: "weekly" });
  });
});
