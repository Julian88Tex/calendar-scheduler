// Schedules to UTC intervals (SCH-01 step 2, AV-04, AV-06, AV-13, GEN-06).
import { describe, expect, it } from "vitest";
import { buildHostBlocks, dateIntervals, hoursForDate, sanitizeRanges } from "./schedule";
import { BERLIN, LA, NY, UTC, at, ranges, schedule, weekly } from "./testing";

describe("sanitizeRanges", () => {
  it("drops zero-length and inverted ranges, clamps to 0..1440 and sorts", () => {
    expect(sanitizeRanges([{ start: 1020, end: 1020 }])).toEqual([]);
    expect(sanitizeRanges([{ start: 600, end: 540 }])).toEqual([]);
    expect(sanitizeRanges([{ start: 780, end: 900 }, { start: -10, end: 60 }, { start: 1400, end: 2000 }])).toEqual([
      { start: 0, end: 60 },
      { start: 780, end: 900 },
      { start: 1400, end: 1440 },
    ]);
    expect(sanitizeRanges(null)).toEqual([]);
    expect(sanitizeRanges([{ start: Number.NaN, end: 60 }])).toEqual([]);
  });
});

describe("hoursForDate precedence", () => {
  const s = schedule(UTC, weekly({ weekdays: [["09:00", "17:00"]] }), {
    overrides: { "2026-10-22": [], "2026-10-23": ranges(["10:00", "14:00"]), "2026-10-24": ranges(["12:00", "13:00"]) },
    blockedDates: ["2026-10-23", "2026-11-26"],
  });

  it("weekday hours by default, empty on unconfigured days", () => {
    expect(hoursForDate(s, "2026-10-21")).toMatchObject({ source: "weekly", ranges: ranges(["09:00", "17:00"]) });
    expect(hoursForDate(s, "2026-10-25").ranges).toEqual([]);
  });

  it("an override replaces the weekday entirely (an empty override means unavailable, AV-06)", () => {
    expect(hoursForDate(s, "2026-10-22")).toMatchObject({ source: "override", ranges: [] });
    expect(hoursForDate(s, "2026-10-24")).toMatchObject({ source: "override", ranges: ranges(["12:00", "13:00"]) });
  });

  it("holidays beat date-specific hours (AV-13) and keep what the date would have offered", () => {
    expect(hoursForDate(s, "2026-10-23")).toEqual({ date: "2026-10-23", source: "holiday", ranges: [], holidayRanges: ranges(["10:00", "14:00"]) });
    expect(hoursForDate(s, "2026-11-26")).toMatchObject({ source: "holiday", holidayRanges: ranges(["09:00", "17:00"]) });
  });
});

describe("dateIntervals", () => {
  it("converts wall-clock minutes in the schedule zone; 1440 is the next local midnight", () => {
    const s = schedule(LA, weekly({ tue: [["17:00", "24:00"]] }));
    expect(dateIntervals(s, "2026-10-13")).toEqual([{ start: at("2026-10-13 17:00", LA), end: at("2026-10-14 00:00", LA) }]);
  });

  it("merges touching ranges of the same date (9 to 12 plus 12 to 17 is one block)", () => {
    const s = schedule(UTC, weekly({ tue: [["12:00", "17:00"], ["09:00", "12:00"]] }));
    expect(dateIntervals(s, "2026-10-13")).toEqual([{ start: at("2026-10-13 09:00", UTC), end: at("2026-10-13 17:00", UTC) }]);
  });

  it("keeps 9:00 local on DST days in New York and Berlin", () => {
    for (const [zone, date] of [
      [NY, "2026-03-08"],
      [NY, "2026-11-01"],
      [BERLIN, "2026-03-29"],
      [BERLIN, "2026-10-25"],
    ] as const) {
      const s = schedule(zone, weekly({ all: [["09:00", "17:00"]] }));
      expect(dateIntervals(s, date)).toEqual([{ start: at(`${date} 09:00`, zone), end: at(`${date} 17:00`, zone) }]);
    }
  });

  it("a whole DST day is 23 or 25 hours long", () => {
    const s = schedule(NY, weekly({ all: [["00:00", "24:00"]] }));
    const spring = dateIntervals(s, "2026-03-08")[0]!;
    const fall = dateIntervals(s, "2026-11-01")[0]!;
    expect((spring.end - spring.start) / 3_600_000).toBe(23);
    expect((fall.end - fall.start) / 3_600_000).toBe(25);
  });
});

describe("buildHostBlocks", () => {
  it("anchors never cross midnight; containment merges across midnight", () => {
    const s = schedule(UTC, weekly({ tue: [["22:00", "24:00"]], wed: [["00:00", "02:00"]] }));
    const b = buildHostBlocks(s, at("2026-10-13 00:00", UTC), at("2026-10-15 00:00", UTC));
    expect(b.anchors).toEqual([
      { start: at("2026-10-13 22:00", UTC), end: at("2026-10-14 00:00", UTC) },
      { start: at("2026-10-14 00:00", UTC), end: at("2026-10-14 02:00", UTC) },
    ]);
    expect(b.containment).toEqual([{ start: at("2026-10-13 22:00", UTC), end: at("2026-10-14 02:00", UTC) }]);
  });

  it("covers the range plus the margin and records holiday anchors separately", () => {
    const s = schedule(UTC, weekly({ all: [["09:00", "10:00"]] }), { blockedDates: ["2026-10-13"] });
    const b = buildHostBlocks(s, at("2026-10-13 00:00", UTC), at("2026-10-14 00:00", UTC), 1);
    expect(b.anchors.map((a) => new Date(a.start).toISOString().slice(0, 10))).toEqual(["2026-10-12", "2026-10-14"]);
    expect(b.holidayAnchors).toEqual([{ start: at("2026-10-13 09:00", UTC), end: at("2026-10-13 10:00", UTC) }]);
    expect(b.holidayContainment).toHaveLength(3);
  });

  it("rejects an invalid schedule zone", () => {
    expect(() => buildHostBlocks(schedule("Nowhere/City", weekly({})), 0, 1)).toThrow(/Invalid time zone/);
  });
});
