// ZoneClock: offsets, wall-clock conversion with deterministic gap and overlap rules, and day number helpers.
import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  ZoneClock,
  dayFromIso,
  isIsoDate,
  isValidTimeZone,
  isoFromDay,
  startOfMonthDay,
  startOfNextMonthDay,
  startOfWeekDay,
  weekdayOfDay,
  zoneClock,
} from "./zone";

const iso = (ms: number) => new Date(ms).toISOString();

describe("day numbers", () => {
  it("round trips ISO dates and rejects impossible ones", () => {
    expect(dayFromIso("1970-01-01")).toBe(0);
    expect(isoFromDay(dayFromIso("2026-10-12"))).toBe("2026-10-12");
    expect(() => dayFromIso("2026-02-30")).toThrow();
    expect(() => dayFromIso("2026-1-1")).toThrow();
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate(20261012)).toBe(false);
  });

  it("weekday, week and month helpers", () => {
    expect(weekdayOfDay(dayFromIso("2026-10-11"))).toBe(0); // Sunday
    expect(weekdayOfDay(dayFromIso("2026-10-12"))).toBe(1);
    expect(weekdayOfDay(dayFromIso("1969-12-31"))).toBe(3);
    const wed = dayFromIso("2026-10-14");
    expect(isoFromDay(startOfWeekDay(wed, 0))).toBe("2026-10-11");
    expect(isoFromDay(startOfWeekDay(wed, 1))).toBe("2026-10-12");
    expect(isoFromDay(startOfWeekDay(dayFromIso("2026-10-11"), 1))).toBe("2026-10-05");
    expect(isoFromDay(startOfMonthDay(wed))).toBe("2026-10-01");
    expect(isoFromDay(startOfNextMonthDay(dayFromIso("2026-12-31")))).toBe("2027-01-01");
  });
});

describe("ZoneClock", () => {
  it("offsets match Intl in both seasons", () => {
    const ny = zoneClock("America/New_York");
    expect(ny.offset(Date.parse("2026-01-15T12:00:00Z"))).toBe(-300);
    expect(ny.offset(Date.parse("2026-07-15T12:00:00Z"))).toBe(-240);
    expect(zoneClock("Asia/Kolkata").offset(Date.parse("2026-07-15T12:00:00Z"))).toBe(330);
    expect(zoneClock("Asia/Kathmandu").offset(Date.parse("2026-07-15T12:00:00Z"))).toBe(345);
    expect(zoneClock("UTC").offset(0)).toBe(0);
  });

  it("finds the exact transition instant (New York, Mar 8 2026 07:00Z)", () => {
    const ny = new ZoneClock("America/New_York");
    expect(ny.offset(Date.parse("2026-03-08T06:59:59Z"))).toBe(-300);
    expect(ny.offset(Date.parse("2026-03-08T07:00:00Z"))).toBe(-240);
    expect(ny.offset(Date.parse("2026-11-01T05:59:59Z"))).toBe(-240);
    expect(ny.offset(Date.parse("2026-11-01T06:00:00Z"))).toBe(-300);
  });

  it("handles transitions at half hours (Lord Howe Island shifts by 30 minutes)", () => {
    const lh = zoneClock("Australia/Lord_Howe");
    const winter = lh.offset(Date.parse("2026-07-01T00:00:00Z"));
    const summer = lh.offset(Date.parse("2026-01-01T00:00:00Z"));
    expect(summer - winter).toBe(30);
    // Wall clock 09:00 maps back to 09:00 on both sides.
    for (const date of ["2026-04-04", "2026-04-06", "2026-10-03", "2026-10-05"]) {
      const day = dayFromIso(date);
      expect(lh.localMinutes(lh.wallToUtc(day, 540))).toBe(540);
    }
  });

  it("nonexistent wall times shift forward by the gap", () => {
    const ny = zoneClock("America/New_York");
    const day = dayFromIso("2026-03-08");
    expect(iso(ny.wallToUtc(day, 150))).toBe("2026-03-08T07:30:00.000Z"); // 02:30 -> 03:30 EDT
    expect(iso(ny.wallToUtc(day, 120))).toBe("2026-03-08T07:00:00.000Z"); // 02:00 -> 03:00 EDT
    expect(ny.wallTimeExists(day, 150)).toBe(false);
    expect(ny.wallTimeExists(day, 180)).toBe(true);
    const berlin = zoneClock("Europe/Berlin");
    expect(iso(berlin.wallToUtc(dayFromIso("2026-03-29"), 150))).toBe("2026-03-29T01:30:00.000Z"); // 02:30 -> 03:30 CEST
  });

  it("ambiguous wall times take the earlier instant", () => {
    const ny = zoneClock("America/New_York");
    expect(iso(ny.wallToUtc(dayFromIso("2026-11-01"), 90))).toBe("2026-11-01T05:30:00.000Z"); // 01:30 EDT
    const berlin = zoneClock("Europe/Berlin");
    expect(iso(berlin.wallToUtc(dayFromIso("2026-10-25"), 150))).toBe("2026-10-25T00:30:00.000Z"); // 02:30 CEST
    expect(ny.wallTimeExists(dayFromIso("2026-11-01"), 90)).toBe(true);
  });

  it("local days and minutes, start of day and transitions", () => {
    const la = zoneClock("America/Los_Angeles");
    const ms = Date.parse("2026-10-14T06:30:00Z"); // 23:30 PDT on Oct 13
    expect(isoFromDay(la.localDay(ms))).toBe("2026-10-13");
    expect(la.localMinutes(ms)).toBe(23 * 60 + 30);
    expect(iso(la.startOfDay(dayFromIso("2026-10-13")))).toBe("2026-10-13T07:00:00.000Z");
    expect(la.hasTransition(dayFromIso("2026-11-01"))).toBe(true);
    expect(la.hasTransition(dayFromIso("2026-11-02"))).toBe(false);
    expect(la.startOfDay(dayFromIso("2026-11-02")) - la.startOfDay(dayFromIso("2026-11-01"))).toBe(DAY_MS + 3_600_000);
  });

  it("a skipped midnight starts the day at the first existing instant (America/Santiago, Sep 6 2026)", () => {
    const scl = zoneClock("America/Santiago");
    const day = dayFromIso("2026-09-06");
    const start = scl.startOfDay(day);
    expect(scl.localDay(start)).toBe(day);
    expect(scl.localMinutes(start)).toBe(60);
  });

  it("plusLocalDays keeps the wall clock across DST", () => {
    const la = zoneClock("America/Los_Angeles");
    const now = Date.parse("2026-10-12T17:00:00Z"); // 10:00 PDT
    expect(iso(la.plusLocalDays(now, 60))).toBe("2026-12-11T18:00:00.000Z"); // 10:00 PST
  });

  it("rejects invalid zones", () => {
    expect(() => zoneClock("Mars/Olympus")).toThrow(/Invalid time zone/);
    expect(isValidTimeZone("Asia/Calcutta")).toBe(true);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
