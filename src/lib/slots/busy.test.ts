// Interval math and busy helpers (ARCHITECTURE 7.4).
import { describe, expect, it } from "vitest";
import {
  BusyIndex,
  expandAllDay,
  intersectAll,
  intersectIntervals,
  matchesFreeBusyException,
  mergeIntervals,
  normalizeBusy,
  splitAtLocalMidnights,
  subtractIntervals,
  unionIntervals,
} from "./busy";
import { LA, NY, UTC, at, calendarBusy, meetingBusy, utc } from "./testing";
import type { BusyInterval } from "./types";

const iv = (start: number, end: number) => ({ start, end });

describe("mergeIntervals", () => {
  it("merges overlapping and touching intervals, drops empty ones, does not mutate input", () => {
    const input = [iv(5, 7), iv(1, 3), iv(3, 4), iv(6, 9), iv(10, 10), iv(12, 11), iv(20, 21)];
    const copy = JSON.parse(JSON.stringify(input));
    expect(mergeIntervals(input)).toEqual([iv(1, 4), iv(5, 9), iv(20, 21)]);
    expect(input).toEqual(copy);
  });

  it("merges duplicate busy blocks from two calendars (observed)", () => {
    expect(mergeIntervals([iv(1, 5), iv(1, 5), iv(2, 3)])).toEqual([iv(1, 5)]);
  });
});

describe("intersect, union, subtract", () => {
  it("intersection keeps touching outputs separate", () => {
    expect(intersectIntervals([iv(0, 10), iv(10, 20)], [iv(5, 15)])).toEqual([iv(5, 10), iv(10, 15)]);
    expect(intersectIntervals([iv(0, 5)], [iv(5, 10)])).toEqual([]);
    expect(intersectIntervals([iv(9, 12)], [iv(9.25, 12)])).toEqual([iv(9.25, 12)]);
  });

  it("intersectAll and unionIntervals", () => {
    expect(intersectAll([[iv(0, 10)], [iv(2, 8)], [iv(4, 20)]])).toEqual([iv(4, 8)]);
    expect(intersectAll([])).toEqual([]);
    expect(unionIntervals([[iv(0, 2)], [iv(2, 4), iv(6, 7)], []])).toEqual([iv(0, 4), iv(6, 7)]);
  });

  it("subtractIntervals removes busy time from availability", () => {
    expect(subtractIntervals([iv(0, 10)], [iv(2, 3), iv(5, 7), iv(9, 12)])).toEqual([iv(0, 2), iv(3, 5), iv(7, 9)]);
    expect(subtractIntervals([iv(0, 10), iv(20, 30)], [iv(-5, 25)])).toEqual([iv(25, 30)]);
    expect(subtractIntervals([iv(0, 10)], [])).toEqual([iv(0, 10)]);
  });
});

describe("splitAtLocalMidnights", () => {
  it("splits at every local midnight, DST correct", () => {
    const pieces = splitAtLocalMidnights([{ start: at("2026-10-31 22:00", NY), end: at("2026-11-02 02:00", NY) }], NY);
    expect(pieces).toEqual([
      { start: at("2026-10-31 22:00", NY), end: at("2026-11-01 00:00", NY) },
      { start: at("2026-11-01 00:00", NY), end: at("2026-11-02 00:00", NY) },
      { start: at("2026-11-02 00:00", NY), end: at("2026-11-02 02:00", NY) },
    ]);
    expect(pieces[1]!.end - pieces[1]!.start).toBe(25 * 3_600_000);
  });

  it("leaves intervals inside one date untouched", () => {
    const one = { start: at("2026-10-13 09:00", UTC), end: at("2026-10-13 17:00", UTC) };
    expect(splitAtLocalMidnights([one], UTC)).toEqual([one]);
  });
});

describe("expandAllDay (SCH-12)", () => {
  it("covers local midnight to local midnight in the host's zone", () => {
    expect(expandAllDay("2026-10-20", "2026-10-21", LA)).toEqual({ start: utc("2026-10-20T07:00:00Z"), end: utc("2026-10-21T07:00:00Z") });
  });

  it("multi-day events block every covered day and DST days have their real length", () => {
    const r = expandAllDay("2026-10-31", "2026-11-03", LA);
    expect(r).toEqual({ start: utc("2026-10-31T07:00:00Z"), end: utc("2026-11-03T08:00:00Z") });
  });

  it("an end on or before the start means one day", () => {
    expect(expandAllDay("2026-10-20", "2026-10-20", UTC)).toEqual(expandAllDay("2026-10-20", "2026-10-21", UTC));
    expect(() => expandAllDay("20261020", "2026-10-21", UTC)).toThrow();
  });
});

describe("matchesFreeBusyException (SCH-13)", () => {
  it("includes is a case-insensitive substring, exact is trimmed equality", () => {
    expect(matchesFreeBusyException("Focus time", [{ mode: "includes", text: "focus" }])).toBe(true);
    expect(matchesFreeBusyException("Deep FOCUS", [{ mode: "includes", text: " Focus " }])).toBe(true);
    expect(matchesFreeBusyException("Focus time", [{ mode: "exact", text: "focus" }])).toBe(false);
    expect(matchesFreeBusyException("  Lunch ", [{ mode: "exact", text: "lunch" }])).toBe(true);
  });

  it("empty titles and empty exception texts never match", () => {
    expect(matchesFreeBusyException(null, [{ mode: "includes", text: "a" }])).toBe(false);
    expect(matchesFreeBusyException("", [{ mode: "includes", text: "a" }])).toBe(false);
    expect(matchesFreeBusyException("Anything", [{ mode: "includes", text: "   " }])).toBe(false);
    expect(matchesFreeBusyException("Anything", [])).toBe(false);
  });
});

describe("BusyIndex", () => {
  const busy: BusyInterval[] = [
    calendarBusy(10, 20, { title: "a" }),
    calendarBusy(0, 1000, { title: "all day" }),
    meetingBusy(30, 40, { meetingId: "m" }),
    calendarBusy(50, 50),
    calendarBusy(60, 70),
  ];

  it("normalizes (sorted, empty dropped)", () => {
    expect(normalizeBusy(busy).map((b) => b.start)).toEqual([0, 10, 30, 60]);
  });

  it("anyOverlap uses merged intervals; overlapping finds long intervals too", () => {
    const idx = new BusyIndex(busy.slice(2));
    expect(idx.anyOverlap(40, 60)).toBe(false);
    expect(idx.anyOverlap(39, 41)).toBe(true);
    expect(idx.anyOverlap(70, 80)).toBe(false);
    const all = new BusyIndex(busy);
    expect(all.overlapping(500, 600).map((b) => b.title)).toEqual(["all day"]);
    expect(all.overlapping(15, 35).map((b) => b.title ?? b.meetingId)).toEqual(["all day", "a", "m"]);
  });

  it("anyOverlapExcept skips the given intervals", () => {
    const idx = new BusyIndex(busy.slice(2));
    expect(idx.anyOverlapExcept(30, 40, (b) => b.meetingId === "m")).toBe(false);
    expect(idx.anyOverlapExcept(30, 65, (b) => b.meetingId === "m")).toBe(true);
  });
});
