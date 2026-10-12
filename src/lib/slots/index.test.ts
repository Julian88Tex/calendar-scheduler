// computeSlots end to end: the owner's observed Calendly behavior (docs/research/calendly-account-observations.md)
// as named regression tests, plus the SCH-01 merge and grid rules from the architecture review.
import { describe, expect, it } from "vitest";
import { computeSlots, expandAllDay } from "@/lib/slots";
import {
  LA,
  OWNER_BLOCK_OFF_WORK,
  OWNER_WORKING_HOURS,
  UTC,
  at,
  calendarBusy,
  dayRange,
  host,
  input,
  isoStarts,
  rules,
  schedule,
  startLocals,
  startTimes,
  timesBetween,
  utc,
  weekly,
} from "./testing";

const owner = (weeklyHours = OWNER_WORKING_HOURS, extra: Parameters<typeof host>[1] = {}) =>
  host("owner", { schedule: schedule(LA, weeklyHours), hostLimitZone: LA, ...extra });

describe("owner observations (Calendly account, 2026-10-11)", () => {
  it("OBS-1: a 120-minute event on Tue 17:00-20:00 PT with 15-minute increments yields 17:00 to 18:00", () => {
    const r = computeSlots(
      input({
        rules: rules({ durationMinutes: 120, incrementMinutes: 15, rangeZone: LA }),
        hosts: [owner(OWNER_BLOCK_OFF_WORK)],
        query: dayRange("2026-10-13", LA),
      }),
    );
    expect(startTimes(r, LA)).toEqual(["17:00", "17:15", "17:30", "17:45", "18:00"]);
    expect(r.slots.every((s) => s.inviteesRemaining === 1)).toBe(true);
  });

  it("OBS-2: 15/15 buffers against an external busy block ending 21:45Z give the next start at 22:00Z", () => {
    const r = computeSlots(
      input({
        rules: rules({ durationMinutes: 30, incrementMinutes: 15, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, rangeZone: LA }),
        hosts: [owner(OWNER_WORKING_HOURS, { busy: [calendarBusy(utc("2026-10-13T20:00:00Z"), utc("2026-10-13T21:45:00Z"))] })],
        query: dayRange("2026-10-13", LA),
      }),
    );
    const starts = isoStarts(r);
    expect(starts).toContain("2026-10-13T22:00:00Z");
    expect(starts).not.toContain("2026-10-13T21:45:00Z");
    expect(starts).not.toContain("2026-10-13T21:30:00Z");
    // Busy 20:00Z to 21:45Z: 19:15Z is the last start before it (19:15 + 30 + 15 = 20:00), 22:00Z the first after.
    expect(starts.filter((s) => s >= "2026-10-13T19:00:00Z" && s <= "2026-10-13T22:00:00Z")).toEqual([
      "2026-10-13T19:00:00Z",
      "2026-10-13T19:15:00Z",
      "2026-10-13T22:00:00Z",
    ]);
  });

  it("OBS-3: a busy block starting 19:00Z makes 18:15Z the last start before it (18:15 + 30 + 15 = 19:00)", () => {
    const r = computeSlots(
      input({
        rules: rules({ durationMinutes: 30, incrementMinutes: 15, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, rangeZone: LA }),
        hosts: [owner(OWNER_WORKING_HOURS, { busy: [calendarBusy(utc("2026-10-13T19:00:00Z"), utc("2026-10-13T20:00:00Z"))] })],
        query: dayRange("2026-10-13", LA),
      }),
    );
    const before = isoStarts(r).filter((s) => s < "2026-10-13T19:00:00Z");
    // Tuesday hours start 11:00 PT = 18:00Z.
    expect(before).toEqual(["2026-10-13T18:00:00Z", "2026-10-13T18:15:00Z"]);
    expect(isoStarts(r)).toContain("2026-10-13T20:15:00Z");
    expect(isoStarts(r)).not.toContain("2026-10-13T20:00:00Z");
  });

  it("OBS-4: an all-day busy event (07:00Z to 07:00Z) removes every slot of that Pacific day", () => {
    const allDay = expandAllDay("2026-10-19", "2026-10-20", LA);
    expect(allDay).toEqual({ start: utc("2026-10-19T07:00:00Z"), end: utc("2026-10-20T07:00:00Z") });
    const base = { rules: rules({ incrementMinutes: 15, rangeZone: LA }), query: dayRange("2026-10-18", LA, 3) };
    const without = computeSlots(input({ ...base, hosts: [owner()] }));
    const withAllDay = computeSlots(input({ ...base, hosts: [owner(OWNER_WORKING_HOURS, { busy: [calendarBusy(allDay.start, allDay.end)] })] }));
    const mondays = (locals: string[]) => locals.filter((l) => l.startsWith("2026-10-19"));
    expect(mondays(startLocals(without, LA)).length).toBeGreaterThan(0);
    expect(mondays(startLocals(withAllDay, LA))).toEqual([]);
    // Sunday and Tuesday are untouched.
    expect(startLocals(withAllDay, LA).filter((l) => !l.startsWith("2026-10-19"))).toEqual(
      startLocals(without, LA).filter((l) => !l.startsWith("2026-10-19")),
    );
  });

  it("OBS-5: zero-length intervals (Mon 17:00-17:00) mean unavailable", () => {
    const r = computeSlots(
      input({ rules: rules({ incrementMinutes: 15, rangeZone: LA }), hosts: [owner(OWNER_BLOCK_OFF_WORK)], query: dayRange("2026-10-12", LA) }),
    );
    expect(r.slots).toEqual([]);
    const fri = computeSlots(
      input({ rules: rules({ incrementMinutes: 15, rangeZone: LA }), hosts: [owner(OWNER_BLOCK_OFF_WORK)], query: dayRange("2026-10-16", LA) }),
    );
    expect(fri.slots).toEqual([]);
  });

  it("OBS-6: duplicate and overlapping busy blocks from two calendars are merged", () => {
    const a = calendarBusy(utc("2026-10-13T19:00:00Z"), utc("2026-10-13T20:00:00Z"), { calendarId: "cal-a" });
    const dup = calendarBusy(utc("2026-10-13T19:00:00Z"), utc("2026-10-13T20:00:00Z"), { calendarId: "cal-b" });
    const overlap = calendarBusy(utc("2026-10-13T19:30:00Z"), utc("2026-10-13T20:30:00Z"), { calendarId: "cal-b" });
    const base = { rules: rules({ incrementMinutes: 15, rangeZone: LA }), query: dayRange("2026-10-13", LA) };
    const one = computeSlots(input({ ...base, hosts: [owner(OWNER_WORKING_HOURS, { busy: [a, overlap] })] }));
    const many = computeSlots(input({ ...base, hosts: [owner(OWNER_WORKING_HOURS, { busy: [overlap, dup, a, dup] })] }));
    expect(isoStarts(many)).toEqual(isoStarts(one));
    expect(isoStarts(one)).not.toContain("2026-10-13T20:00:00Z");
    expect(isoStarts(one)).toContain("2026-10-13T20:30:00Z");
  });

  it("OBS-7: increments are 15 minutes for 30, 60 and 120 minute events (not equal to the duration)", () => {
    for (const duration of [30, 60, 120]) {
      const r = computeSlots(
        input({ rules: rules({ durationMinutes: duration, incrementMinutes: 15, rangeZone: LA }), hosts: [owner()], query: dayRange("2026-10-16", LA) }),
      );
      // Friday 11:00 to 17:00: last start = 17:00 - duration.
      const last = 17 * 60 - duration;
      expect(startTimes(r, LA)).toEqual(timesBetween("11:00", `${Math.floor(last / 60)}:${String(last % 60).padStart(2, "0")}`, 15));
    }
  });
});

describe("SCH-01 merge rule and per-date anchoring", () => {
  it("touching blocks 9:00-12:00 plus 12:00-17:00 offer 11:30 for a 60-minute event", () => {
    const r = computeSlots(
      input({
        rules: rules({ durationMinutes: 60, incrementMinutes: 30 }),
        hosts: [host("h", { schedule: schedule(UTC, weekly({ tue: [["09:00", "12:00"], ["12:00", "17:00"]] })) })],
        query: dayRange("2026-10-13", UTC),
      }),
    );
    expect(startTimes(r, UTC)).toEqual(timesBetween("09:00", "16:00", 30));
    expect(startTimes(r, UTC)).toContain("11:30");
  });

  it("22:00-24:00 plus 00:00-02:00 offer 23:30 and anchor the next date at 00:00", () => {
    const r = computeSlots(
      input({
        rules: rules({ durationMinutes: 60, incrementMinutes: 30 }),
        hosts: [host("h", { schedule: schedule(UTC, weekly({ tue: [["22:00", "24:00"]], wed: [["00:00", "02:00"]] })) })],
        query: dayRange("2026-10-13", UTC, 2),
      }),
    );
    expect(startLocals(r, UTC)).toEqual([
      "2026-10-13 22:00",
      "2026-10-13 22:30",
      "2026-10-13 23:00",
      "2026-10-13 23:30",
      "2026-10-14 00:00",
      "2026-10-14 00:30",
      "2026-10-14 01:00",
    ]);
  });

  it("the next date's grid restarts at 00:00 even when the evening block is off the 00:00 grid", () => {
    const r = computeSlots(
      input({
        rules: rules({ durationMinutes: 30, incrementMinutes: 45 }),
        hosts: [host("h", { schedule: schedule(UTC, weekly({ tue: [["22:10", "24:00"]], wed: [["00:00", "01:30"]] })) })],
        query: dayRange("2026-10-13", UTC, 2),
      }),
    );
    expect(startLocals(r, UTC)).toEqual(["2026-10-13 22:10", "2026-10-13 22:55", "2026-10-13 23:40", "2026-10-14 00:00", "2026-10-14 00:45"]);
  });

  for (const increment of [15, 25, 30, 45]) {
    it(`the grid of a date is identical for range starts on that date and a month earlier (${increment} min, 24-hour schedule)`, () => {
      const base = {
        rules: rules({ durationMinutes: 30, incrementMinutes: increment, rangeZone: LA }),
        hosts: [host("h", { schedule: schedule(LA, weekly({ all: [["00:00", "24:00"]] })) })],
      };
      const sameDay = computeSlots(input({ ...base, query: dayRange("2026-11-20", LA) }));
      const monthEarlier = computeSlots(input({ ...base, query: { rangeStart: dayRange("2026-10-20", LA).rangeStart, rangeEnd: dayRange("2026-11-20", LA).rangeEnd } }));
      const onDate = monthEarlier.slots.filter((s) => s.start >= dayRange("2026-11-20", LA).rangeStart);
      expect(onDate.map((s) => s.start)).toEqual(sameDay.slots.map((s) => s.start));
      expect(timeOf0(sameDay.slots[0]!.start)).toBe("00:00");
    });
  }

  it("the grid of a date is identical for range starts on that date and a month earlier (owner working hours)", () => {
    const base = { rules: rules({ durationMinutes: 30, incrementMinutes: 25, rangeZone: LA }), hosts: [owner()] };
    const a = computeSlots(input({ ...base, query: dayRange("2026-11-18", LA) }));
    const b = computeSlots(input({ ...base, query: { rangeStart: dayRange("2026-10-18", LA).rangeStart, rangeEnd: dayRange("2026-11-18", LA).rangeEnd } }));
    expect(b.slots.filter((s) => s.start >= a.slots[0]!.start).map((s) => s.start)).toEqual(a.slots.map((s) => s.start));
  });

  it("a range starting mid-block keeps the block's grid (range start at 10:10 still yields 10:30, not 10:10)", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 30 }),
        hosts: [host("h", { schedule: schedule(UTC, weekly({ tue: [["09:00", "12:00"]] })) })],
        query: { rangeStart: at("2026-10-13 10:10", UTC), rangeEnd: at("2026-10-14 00:00", UTC) },
      }),
    );
    expect(startTimes(r, UTC)).toEqual(["10:30", "11:00", "11:30"]);
  });
});

function timeOf0(ms: number): string {
  return startTimes({ slots: [{ start: ms, end: ms, inviteesRemaining: 1, eligibleHostIds: [], eligibleByPool: {} }], windowEnd: null }, LA)[0]!;
}
