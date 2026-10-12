// Adversarial review regressions for the slot engine and holidays: bugs found in review (each named after the defect)
// plus extra DST, business-day window and limit cases (America/New_York and Europe/Berlin, spring forward and fall
// back, schedules in another zone than the range zone).
import { describe, expect, it } from "vitest";
import { getHolidays, blockedDatesFor, COUNTRY_NAMES, SUPPORTED_COUNTRIES } from "@/lib/holidays";
import * as countries from "@/lib/holidays/countries";
import { rawHolidays } from "@/lib/holidays/data";
import { MAX_QUERY_DAYS, bookingWindow, computeSlots } from "@/lib/slots";
import type { CandidateDiagnostic, SlotEngineInput } from "@/lib/slots";
import {
  BERLIN,
  LA,
  NY,
  UTC,
  at,
  calendarBusy,
  dayRange,
  host,
  input,
  isoOf,
  localOf,
  meetingBusy,
  rules,
  schedule,
  startLocals,
  startTimes,
  utc,
  weekly,
} from "@/lib/slots/testing";

const MIN = 60_000;
const DAY = 86_400_000;
const allDay = (zone: string) => schedule(zone, weekly({ all: [["00:00", "24:00"]] }));
const nineToFive = (zone: string) => schedule(zone, weekly({ all: [["09:00", "17:00"]] }));

function diagnose(i: SlotEngineInput): CandidateDiagnostic[] {
  const r = computeSlots({ ...i, query: { ...i.query, troubleshoot: true } });
  expect(r.diagnostics!.filter((d) => d.available).map((d) => d.start)).toEqual(r.slots.map((s) => s.start));
  return r.diagnostics!;
}

describe("holidays: moved days that date-holidays reports without the substitute flag", () => {
  it("AU New Year's Day on a Saturday keeps the Monday holiday (2028-01-03) as its own substitute row", () => {
    const list = getHolidays("AU", 2028);
    expect(list.find((h) => h.date === "2028-01-01")).toMatchObject({ key: "AU:01-01", substitute: false, name: "New Year's Day" });
    expect(list.find((h) => h.date === "2028-01-03")).toEqual({
      key: "AU:01-01:substitute",
      date: "2028-01-03",
      name: "New Year's Day (substitute day)",
      substitute: true,
    });
    // The Monday is blocked, and its own switch can turn it off.
    expect(blockedDatesFor("AU", {}, "2028-01-01", "2028-01-05", "Australia/Sydney")).toEqual(["2028-01-01", "2028-01-03"]);
    expect(blockedDatesFor("AU", { "AU:01-01:substitute": false }, "2028-01-01", "2028-01-05", "Australia/Sydney")).toEqual(["2028-01-01"]);
  });

  it("no country ever loses a public holiday entry to key de-duplication (2020 to 2060)", () => {
    for (const c of SUPPORTED_COUNTRIES) {
      for (let y = 2020; y <= 2060; y++) {
        const list = getHolidays(c, y);
        expect(list.length, `${c} ${y}`).toBe(rawHolidays(c, y).length);
        expect(new Set(list.map((h) => h.key)).size, `${c} ${y}`).toBe(list.length);
      }
    }
  });

  it("the country list is available from the client-safe module without the rule data", () => {
    expect(countries.SUPPORTED_COUNTRIES).toBe(SUPPORTED_COUNTRIES);
    expect(countries.COUNTRY_NAMES).toBe(COUNTRY_NAMES);
    expect(countries.isSupportedCountry("NL")).toBe(true);
  });
});

describe("hour alignment on fall back days (both instants of the repeated hour)", () => {
  it("New York Nov 1 2026: a 00:00-04:00 block offers 01:00 and 01:30 twice, 30 minutes apart", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 30, alignment: "hour", rangeZone: NY }),
        hosts: [host("h", { schedule: schedule(NY, weekly({ all: [["00:00", "04:00"]] })) })],
        query: dayRange("2026-11-01", NY),
      }),
    );
    expect(r.slots.map((s) => isoOf(s.start))).toEqual([
      "2026-11-01T04:00:00Z",
      "2026-11-01T04:30:00Z",
      "2026-11-01T05:00:00Z",
      "2026-11-01T05:30:00Z",
      "2026-11-01T06:00:00Z",
      "2026-11-01T06:30:00Z",
      "2026-11-01T07:00:00Z",
      "2026-11-01T07:30:00Z",
      "2026-11-01T08:00:00Z",
      "2026-11-01T08:30:00Z",
    ]);
    expect(startTimes(r, NY)).toEqual(["00:00", "00:30", "01:00", "01:30", "01:00", "01:30", "02:00", "02:30", "03:00", "03:30"]);
  });

  it("the same block with interval_start alignment gives the same starts (one grid per real hour)", () => {
    const run = (alignment: "hour" | "interval_start") =>
      computeSlots(
        input({
          rules: rules({ incrementMinutes: 30, alignment, rangeZone: BERLIN }),
          hosts: [host("h", { schedule: schedule(BERLIN, weekly({ all: [["00:00", "05:00"]] })) })],
          query: dayRange("2026-10-25", BERLIN),
        }),
      ).slots.map((s) => s.start);
    expect(run("hour")).toEqual(run("interval_start"));
    expect(run("hour")).toHaveLength(12); // 6 real hours on the 25-hour day, minus the last 30 minutes
  });

  it("troubleshoot outside-hours grid lists the repeated hour twice as well", () => {
    const d = diagnose(
      input({
        rules: rules({ incrementMinutes: 60, rangeZone: NY }),
        hosts: [host("h", { schedule: nineToFive(NY) })],
        query: { ...dayRange("2026-11-01", NY), diagnoseOutsideHours: true },
      }),
    );
    const outside = d.filter((x) => x.outsideHours).map((x) => localOf(x.start, NY).slice(11));
    expect(outside.filter((t) => t === "01:00")).toHaveLength(2);
    expect(d).toHaveLength(25);
  });
});

describe("troubleshoot: starts outside a host's own hours are flagged", () => {
  it("a single host's existing group slot outside its hours explains itself (outsideHours)", () => {
    const s = at("2026-10-13 07:30", UTC);
    const d = diagnose(
      input({
        rules: rules({ kind: "group", seats: 3, groupSlots: [{ start: s, end: s + 30 * MIN, remaining: 1, meetingId: "g1" }] }),
        hosts: [host("h", { schedule: nineToFive(UTC) })],
        query: dayRange("2026-10-13", UTC),
      }),
    );
    const entry = d.find((x) => x.start === s)!;
    expect(entry).toMatchObject({ available: false, reasons: [], outsideHours: true });
    expect(entry.hosts.h).toEqual({ available: false, reasons: [], blockers: [], outsideHours: true });
    // Times inside the hours carry no flag.
    expect(d.find((x) => x.start === at("2026-10-13 09:00", UTC))!.outsideHours).toBeUndefined();
  });

  it("a collective host outside its hours is flagged in its own entry next to HOST", () => {
    const d = diagnose(
      input({
        rules: rules({ pooling: "collective" }),
        hosts: [host("a", { schedule: nineToFive(UTC) }), host("b", { schedule: schedule(UTC, weekly({ all: [["10:00", "17:00"]] })) })],
        query: { ...dayRange("2026-10-13", UTC), diagnoseOutsideHours: true },
      }),
    );
    const nine = d.find((x) => x.start === at("2026-10-13 09:00", UTC))!;
    expect(nine.reasons).toEqual(["HOST"]);
    expect(nine.hosts.a).toMatchObject({ available: true });
    expect(nine.hosts.b).toMatchObject({ available: false, outsideHours: true });
  });
});

describe("query span guard", () => {
  it(`never evaluates more than ${MAX_QUERY_DAYS} days of starts in one call`, () => {
    const rangeStart = utc("2026-01-01T00:00:00Z");
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 60, durationMinutes: 60 }),
        hosts: [host("h", { schedule: schedule(UTC, weekly({ all: [["09:00", "10:00"]] })) })],
        query: { rangeStart, rangeEnd: rangeStart + 100 * 365 * DAY, now: rangeStart - DAY },
      }),
    );
    expect(r.slots).toHaveLength(MAX_QUERY_DAYS);
    expect(r.slots.at(-1)!.start).toBeLessThan(rangeStart + MAX_QUERY_DAYS * DAY);
  });
});

describe("DST: notice, buffers, windows and limits", () => {
  it("minimum notice counts elapsed time across the New York spring change (4 hours from 00:30 EST is 05:30 EDT)", () => {
    const now = at("2026-03-08 00:30", NY);
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 30, minimumNoticeMinutes: 240, rangeZone: NY }),
        hosts: [host("h", { schedule: allDay(NY) })],
        query: { ...dayRange("2026-03-08", NY), now },
      }),
    );
    expect(isoOf(r.slots[0]!.start)).toBe("2026-03-08T09:30:00Z");
    expect(startTimes(r, NY)[0]).toBe("05:30");
  });

  it("buffers are elapsed time across the spring gap: busy until 03:00 EDT with a 15 minute before buffer gives 03:15", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 15, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, rangeZone: NY }),
        hosts: [host("h", { schedule: allDay(NY), busy: [calendarBusy(at("2026-03-08 00:00", NY), at("2026-03-08 03:00", NY))] })],
        query: dayRange("2026-03-08", NY),
      }),
    );
    expect(startTimes(r, NY)[0]).toBe("03:15");
    expect(isoOf(r.slots[0]!.start)).toBe("2026-03-08T07:15:00Z");
  });

  it("an app meeting's stored buffers stack across the Berlin fall back hour", () => {
    // Meeting 02:00-02:30 CET (second 02:00), 15/15 stored buffers; candidate needs its own 15/15 too.
    const second0200 = utc("2026-10-25T01:00:00Z");
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 15, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, rangeZone: BERLIN }),
        hosts: [host("h", { schedule: allDay(BERLIN), busy: [meetingBusy(second0200, second0200 + 30 * MIN, { before: 15, after: 15 })] })],
        query: dayRange("2026-10-25", BERLIN),
      }),
    );
    const starts = r.slots.map((s) => s.start);
    // Last start before: 30 + 15 + 15 = 60 minutes before the meeting; first after: 30 + 15 + 15 after its start.
    expect(starts).toContain(second0200 - 60 * MIN);
    expect(starts).not.toContain(second0200 - 45 * MIN);
    expect(starts).toContain(second0200 + 60 * MIN);
    expect(starts).not.toContain(second0200 + 45 * MIN);
  });

  it("rolling calendar days keep the wall clock across the Berlin fall change (7 days at 08:00 on Oct 22)", () => {
    const now = at("2026-10-22 08:00", BERLIN);
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 15, rangeZone: BERLIN, dateRange: { type: "rolling", days: 7, mode: "calendar_days" } }),
        hosts: [host("h", { schedule: schedule(BERLIN, weekly({ all: [["08:00", "17:00"]] })) })],
        query: { ...dayRange("2026-10-29", BERLIN), now },
      }),
    );
    expect(startLocals(r, BERLIN)).toEqual(["2026-10-29 08:00"]);
    expect(r.windowEnd).toBe(at("2026-10-29 08:00", BERLIN) + 1);
  });

  it("rolling weekdays across the Berlin spring change: Thu 10:00 with 2 week days ends Mon 10:00 CEST", () => {
    const now = at("2026-03-26 10:00", BERLIN); // Thursday
    const w = bookingWindow({ rules: rules({ rangeZone: BERLIN, dateRange: { type: "rolling", days: 2, mode: "weekdays" } }), hosts: [], now });
    expect(w.end).toBe(at("2026-03-30 10:00", BERLIN) + 1);
    expect(w.end! - now).toBe(4 * DAY - 3_600_000 + 1);
  });

  it("rolling weekdays: Friday 18:00 with 10 week days skips two weekends and ends two Fridays later at 18:00", () => {
    const now = at("2026-10-16 18:00", LA);
    const w = bookingWindow({ rules: rules({ rangeZone: LA, dateRange: { type: "rolling", days: 10, mode: "weekdays" } }), hosts: [], now });
    expect(localOf(w.end! - 1, LA)).toBe("2026-10-30 18:00");
  });

  it("rolling weekdays from a Sunday count Monday as the first week day", () => {
    const now = at("2026-10-18 09:00", NY);
    const w = bookingWindow({ rules: rules({ rangeZone: NY, dateRange: { type: "rolling", days: 1, mode: "weekdays" } }), hosts: [], now });
    expect(localOf(w.end! - 1, NY)).toBe("2026-10-19 09:00");
  });

  it("days with availability across the New York fall change count local dates (window ends at local midnight)", () => {
    const now = at("2026-10-30 10:00", NY); // Friday
    const w = bookingWindow({
      rules: rules({ rangeZone: NY, dateRange: { type: "rolling", days: 3, mode: "available_days" } }),
      hosts: [host("h", { schedule: schedule(NY, weekly({ weekdays: [["09:00", "17:00"]] })) })],
      now,
    });
    // Fri Oct 30 (ends 17:00, after now), Mon Nov 2, Tue Nov 3: the window ends at midnight after Tuesday (EST).
    expect(w.end).toBe(at("2026-11-04 00:00", NY));
  });

  it("weekly event type limits use local weeks on a 25-hour Sunday (Berlin, Monday week start)", () => {
    const lateSunday = at("2026-10-25 23:30", BERLIN);
    const r = computeSlots(
      input({
        rules: rules({
          rangeZone: BERLIN,
          weekStart: 1,
          limits: { week: 1 },
          eventTypeMeetingStarts: [{ start: lateSunday, meetingId: "m1" }],
        }),
        hosts: [host("h", { schedule: nineToFive(BERLIN) })],
        query: dayRange("2026-10-24", BERLIN, 3),
      }),
    );
    const dates = new Set(startLocals(r, BERLIN).map((l) => l.slice(0, 10)));
    expect(dates.has("2026-10-24")).toBe(false); // same week as the Sunday meeting
    expect(dates.has("2026-10-25")).toBe(false);
    expect(dates.has("2026-10-26")).toBe(true); // a new week starts Monday 00:00 CET
  });

  it("host daily limits count the host zone's local day on the Los Angeles fall back day", () => {
    const lateNov1 = at("2026-11-01 23:30", LA); // 07:30Z on Nov 2
    const r = computeSlots(
      input({
        rules: rules({ rangeZone: LA }),
        hosts: [host("h", { schedule: nineToFive(LA), hostLimitZone: LA, hostLimits: { day: 1 }, hostMeetingStarts: [{ start: lateNov1, meetingId: "m" }] })],
        query: dayRange("2026-11-01", LA, 2),
      }),
    );
    const dates = new Set(startLocals(r, LA).map((l) => l.slice(0, 10)));
    expect(dates.has("2026-11-01")).toBe(false);
    expect(dates.has("2026-11-02")).toBe(true);
  });

  it("a Berlin schedule seen from a New York range zone keeps 9:00 Berlin on both sides of both spring changes", () => {
    // US changes Mar 8, EU changes Mar 29: 9:00 Berlin is 03:00 New York before Mar 8, 04:00 between, 03:00 after.
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 60, durationMinutes: 60, rangeZone: NY }),
        hosts: [host("h", { schedule: schedule(BERLIN, weekly({ all: [["09:00", "10:00"]] })) })],
        query: { rangeStart: at("2026-03-01 00:00", NY), rangeEnd: at("2026-04-05 00:00", NY) },
      }),
    );
    const byDate = Object.fromEntries(r.slots.map((s) => [localOf(s.start, BERLIN).slice(0, 10), localOf(s.start, NY).slice(11)]));
    expect(Object.values(Object.fromEntries(r.slots.map((s) => [s.start, localOf(s.start, BERLIN).slice(11)])))).toEqual(
      Array(r.slots.length).fill("09:00"),
    );
    expect(byDate["2026-03-07"]).toBe("03:00");
    expect(byDate["2026-03-10"]).toBe("04:00");
    expect(byDate["2026-03-31"]).toBe("03:00");
  });
});
