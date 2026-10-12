// Period keys and counting (SCH-08, SCH-09, SCH-24).
import { describe, expect, it } from "vitest";
import { countByPeriod, hasLimits, limitCountSpan, periodKeysOf, reachedPeriods } from "./limits";
import { LA, UTC, at, isoOf } from "./testing";
import { isoFromDay, zoneClock } from "./zone";

describe("periodKeysOf", () => {
  it("day, week (Sunday or Monday start) and month in the zone", () => {
    const ms = at("2026-11-01 23:30", LA); // Sunday, Nov 2 07:30Z
    const sun = periodKeysOf(ms, zoneClock(LA), 0);
    const mon = periodKeysOf(ms, zoneClock(LA), 1);
    expect(isoFromDay(sun.day)).toBe("2026-11-01");
    expect(isoFromDay(sun.week)).toBe("2026-11-01");
    expect(isoFromDay(mon.week)).toBe("2026-10-26");
    expect(sun.month).toBe(2026 * 12 + 10);
  });
});

describe("countByPeriod and reachedPeriods", () => {
  const starts = [
    { start: at("2026-11-29 10:00", UTC), meetingId: "a" }, // Sunday
    { start: at("2026-11-30 10:00", UTC), meetingId: "b" }, // Monday
    { start: at("2026-11-30 11:00", UTC), meetingId: "b" }, // duplicate meeting id: counted once
    { start: at("2026-12-01 10:00", UTC), meetingId: "moving" },
  ];

  it("counts each meeting id once and skips ignored ids", () => {
    const counts = countByPeriod(starts, UTC, 0, new Set(["moving"]));
    expect([...counts.day.values()]).toEqual([1, 1]);
    expect([...counts.week.values()]).toEqual([2]);
    expect([...counts.month.values()]).toEqual([2]);
  });

  it("weeks straddle month boundaries", () => {
    const counts = countByPeriod(starts, UTC, 0, new Set());
    const tue = periodKeysOf(at("2026-12-01 15:00", UTC), zoneClock(UTC), 0);
    expect(reachedPeriods(tue, counts, { week: 3 })).toEqual(["week"]);
    expect(reachedPeriods(tue, counts, { week: 4, month: 1 })).toEqual(["month"]);
    expect(reachedPeriods(tue, counts, { day: 1 })).toEqual(["day"]);
    expect(reachedPeriods(tue, counts, { day: null, week: undefined })).toEqual([]);
  });

  it("hasLimits", () => {
    expect(hasLimits({})).toBe(false);
    expect(hasLimits({ day: null })).toBe(false);
    expect(hasLimits({ month: 3 })).toBe(true);
    expect(hasLimits(null)).toBe(false);
  });
});

describe("limitCountSpan", () => {
  it("covers whole weeks around whole months of the range", () => {
    const span = limitCountSpan(at("2026-12-01 00:00", UTC), at("2027-01-01 00:00", UTC), UTC, 0);
    expect(isoOf(span.start)).toBe("2026-11-29T00:00:00Z"); // Sunday of the week containing Dec 1
    expect(isoOf(span.end)).toBe("2027-01-03T00:00:00Z"); // after Saturday Jan 2 (week of Dec 31)
    const monday = limitCountSpan(at("2026-12-10 00:00", UTC), at("2026-12-12 00:00", UTC), UTC, 1);
    expect(isoOf(monday.start)).toBe("2026-11-30T00:00:00Z");
    expect(isoOf(monday.end)).toBe("2027-01-04T00:00:00Z");
  });

  it("uses local dates of the zone", () => {
    const span = limitCountSpan(at("2026-11-01 00:00", LA), at("2026-12-01 00:00", LA), LA, 0);
    expect(span.start).toBe(at("2026-11-01 00:00", LA));
    expect(span.end).toBe(at("2026-12-06 00:00", LA));
  });
});
