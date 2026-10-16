// DST suites (GEN-06, SCH-01, SCH-10, SCH-22): America/New_York (2026: Mar 8 spring forward, Nov 1 fall back) and
// Europe/Berlin (2026: Mar 29 spring forward, Oct 25 fall back). Schedules keep wall-clock hours on both sides of a
// change; nonexistent local times shift forward; ambiguous local times take the earlier instant; schedules in a
// different zone than the invitee or the range zone give the same instants.
import { describe, expect, it } from "vitest";
import { computeSlots } from "@/lib/slots";
import { BERLIN, LA, NY, UTC, at, dayRange, host, input, isoOf, localOf, rules, schedule, startLocals, startTimes, timeOf, utc, weekly } from "./testing";

const nineToFive = (zone: string) => schedule(zone, weekly({ all: [["09:00", "17:00"]] }));

function week(zone: string, firstDate: string) {
  return computeSlots(
    input({
      rules: rules({ incrementMinutes: 30, rangeZone: zone }),
      hosts: [host("h", { schedule: nineToFive(zone) })],
      query: dayRange(firstDate, zone, 7),
    }),
  );
}

function firstAndLastPerDate(locals: string[]): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  for (const l of locals) {
    const [d, time] = l.split(" ") as [string, string];
    out[d] = out[d] ? [out[d][0], time] : [time, time];
  }
  return out;
}

describe.each([
  { zone: NY, spring: "2026-03-08", fall: "2026-11-01" },
  { zone: BERLIN, spring: "2026-03-29", fall: "2026-10-25" },
])("DST in $zone", ({ zone, spring, fall }) => {
  for (const [label, date] of [
    ["spring forward", spring],
    ["fall back", fall],
  ] as const) {
    it(`a 9:00 to 17:00 schedule produces 9:00 local slots on both sides of ${label} (${date})`, () => {
      const r = week(zone, addDays(date, -3));
      const perDate = firstAndLastPerDate(startLocals(r, zone));
      expect(Object.keys(perDate)).toHaveLength(7);
      for (const [d, [first, last]] of Object.entries(perDate)) {
        expect([d, first]).toEqual([d, "09:00"]);
        expect([d, last]).toEqual([d, "16:30"]);
      }
      // The UTC instant of 9:00 moves by one hour across the change.
      const before = at(`${addDays(date, -1)} 09:00`, zone);
      const after = at(`${addDays(date, 1)} 09:00`, zone);
      expect(Math.abs(after - before - 2 * 86_400_000)).toBe(3_600_000);
      expect(r.slots.map((s) => s.start)).toContain(before);
      expect(r.slots.map((s) => s.start)).toContain(after);
    });
  }

  it("a 24-hour schedule has 46 half-hour starts on the spring day and 50 on the fall day, each grid starting at 00:00", () => {
    const run = (date: string) =>
      computeSlots(
        input({
          rules: rules({ incrementMinutes: 30, rangeZone: zone }),
          hosts: [host("h", { schedule: schedule(zone, weekly({ all: [["00:00", "24:00"]] })) })],
          query: dayRange(date, zone),
        }),
      );
    const springDay = run(spring);
    const fallDay = run(fall);
    expect(springDay.slots).toHaveLength(46);
    expect(fallDay.slots).toHaveLength(50);
    expect(timeOf(springDay.slots[0]!.start, zone)).toBe("00:00");
    expect(timeOf(fallDay.slots[0]!.start, zone)).toBe("00:00");
    // The next day starts its own grid at 00:00.
    const next = run(addDays(fall, 1));
    expect(timeOf(next.slots[0]!.start, zone)).toBe("00:00");
  });

  it("hour alignment skips nonexistent times on the spring day and offers both instants of the repeated hour on the fall day", () => {
    const run = (date: string) =>
      computeSlots(
        input({
          rules: rules({ incrementMinutes: 30, alignment: "hour", rangeZone: zone }),
          hosts: [host("h", { schedule: schedule(zone, weekly({ all: [["00:00", "24:00"]] })) })],
          query: dayRange(date, zone),
        }),
      );
    const springTimes = startTimes(run(spring), zone);
    expect(springTimes).toHaveLength(46);
    expect(springTimes).not.toContain("02:00");
    expect(springTimes).not.toContain("02:30");
    expect(springTimes).toContain("03:00");
    // The fall day has 25 hours: like the interval_start grid it offers 50 starts, the repeated hour twice (at its
    // summer time and its standard time instant), 30 minutes apart in real time.
    const fallDay = run(fall);
    const fallTimes = startTimes(fallDay, zone);
    expect(fallTimes).toHaveLength(50);
    expect(new Set(fallTimes).size).toBe(48);
    const repeated = zone === NY ? "01:00" : "02:00";
    expect(fallTimes.filter((t) => t === repeated)).toHaveLength(2);
    const starts = fallDay.slots.map((s) => s.start);
    expect(starts.every((s, i) => i === 0 || s - starts[i - 1]! === 30 * 60_000)).toBe(true);
  });

  it("hour alignment keeps the repeated hour's second occurrence when the block starts inside it", () => {
    // A UTC schedule whose Sunday hours start at the second (standard time) 01:15 in New York or 02:15 in Berlin:
    // the hour grid of the range zone still offers the second 01:30 (02:30), then the following half hours.
    const secondOccurrence = zone === NY ? utc(`${fall}T06:15:00Z`) : utc(`${fall}T01:15:00Z`);
    const startMinutes = new Date(secondOccurrence).getUTCHours() * 60 + 15;
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 30, alignment: "hour", rangeZone: zone }),
        hosts: [host("h", { schedule: schedule(UTC, weekly({ sun: [[hhmm(startMinutes), hhmm(startMinutes + 105)]] })) })],
        query: dayRange(fall, zone),
      }),
    );
    expect(r.slots.map((x) => isoOf(x.start))).toEqual(
      [15, 45, 75].map((m) => isoOf(secondOccurrence + m * 60_000)),
    );
    expect(timeOf(r.slots[0]!.start, zone)).toBe(zone === NY ? "01:30" : "02:30");
  });
});

describe("nonexistent and ambiguous local times", () => {
  it("a range starting at a nonexistent time (02:30 on Mar 8 in New York) shifts forward to 03:30 EDT", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 30, rangeZone: NY }),
        hosts: [host("h", { schedule: schedule(NY, weekly({ sun: [["02:30", "05:00"]] })) })],
        query: dayRange("2026-03-08", NY),
      }),
    );
    expect(startTimes(r, NY)).toEqual(["03:30", "04:00", "04:30"]);
    expect(isoOf(r.slots[0]!.start)).toBe("2026-03-08T07:30:00Z");
  });

  it("a range entirely inside the gap (02:00 to 02:30) shifts forward to 03:00 to 03:30", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 30, rangeZone: NY }),
        hosts: [host("h", { schedule: schedule(NY, weekly({ sun: [["02:00", "02:30"]] })) })],
        query: dayRange("2026-03-08", NY),
      }),
    );
    expect(startTimes(r, NY)).toEqual(["03:00"]);
  });

  it("an ambiguous start (01:30 on Nov 1 in New York) takes the earlier instant (EDT) and the block keeps its real length", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 30, rangeZone: NY }),
        hosts: [host("h", { schedule: schedule(NY, weekly({ sun: [["01:30", "02:30"]] })) })],
        query: dayRange("2026-11-01", NY),
      }),
    );
    // 01:30 EDT (05:30Z) to 02:30 EST (07:30Z) is two real hours.
    expect(r.slots.map((s) => isoOf(s.start))).toEqual(["2026-11-01T05:30:00Z", "2026-11-01T06:00:00Z", "2026-11-01T06:30:00Z", "2026-11-01T07:00:00Z"]);
  });

  it("the result does not depend on the current date (no hidden clock)", () => {
    const run = (now: number) =>
      computeSlots(
        input({
          rules: rules({ incrementMinutes: 30, rangeZone: NY }),
          hosts: [host("h", { schedule: schedule(NY, weekly({ sun: [["01:00", "03:00"]] })) })],
          query: { ...dayRange("2026-11-01", NY), now },
        }),
      ).slots.map((s) => s.start);
    expect(run(utc("2020-01-15T00:00:00Z"))).toEqual(run(utc("2020-07-15T00:00:00Z")));
  });
});

describe("schedules in a different zone than the invitee", () => {
  it("a Los Angeles 17:00 slot is 01:00 next day in Berlin during the week between the EU and US changes (SCH-22)", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 60, rangeZone: LA }),
        hosts: [host("h", { schedule: schedule(LA, weekly({ all: [["17:00", "18:00"]] })) })],
        query: dayRange("2026-10-27", LA),
      }),
    );
    expect(r.slots.map((s) => localOf(s.start, BERLIN))).toEqual(["2026-10-28 01:00"]);
  });

  it("slots requested per invitee-local day (Berlin) match the host-zone (Los Angeles) slots across both DST changes", () => {
    const base = {
      rules: rules({ incrementMinutes: 30, durationMinutes: 45, rangeZone: LA }),
      hosts: [host("h", { schedule: schedule(LA, weekly({ all: [["08:00", "20:00"]] })) })],
    };
    const whole = computeSlots(input({ ...base, query: { rangeStart: at("2026-10-20 00:00", BERLIN), rangeEnd: at("2026-11-05 00:00", BERLIN) } }));
    const perDay: number[] = [];
    for (let d = "2026-10-20"; d < "2026-11-05"; d = addDays(d, 1)) {
      perDay.push(...computeSlots(input({ ...base, query: dayRange(d, BERLIN) })).slots.map((s) => s.start));
    }
    expect(perDay).toEqual(whole.slots.map((s) => s.start));
    expect(new Set(whole.slots.map((s) => timeOf(s.start, LA).slice(0, 2))).has("08")).toBe(true);
    expect(whole.slots.every((s) => timeOf(s.start, LA) >= "08:00" && timeOf(s.start, LA) <= "19:15")).toBe(true);
  });

  it("collective New York and Berlin hosts overlap one hour longer between the US and EU spring changes", () => {
    const overlap = (date: string) =>
      startTimes(
        computeSlots(
          input({
            rules: rules({ pooling: "collective", durationMinutes: 60, incrementMinutes: 60, rangeZone: NY }),
            hosts: [host("ny", { schedule: nineToFive(NY) }), host("de", { schedule: nineToFive(BERLIN) })],
            query: dayRange(date, NY),
          }),
        ),
        NY,
      );
    expect(overlap("2026-03-06")).toEqual(["09:00", "10:00"]); // 6 hours apart
    expect(overlap("2026-03-10")).toEqual(["09:00", "10:00", "11:00"]); // 5 hours apart
    expect(overlap("2026-03-31")).toEqual(["09:00", "10:00"]);
  });

  it("a UTC range zone with a New York schedule splits anchors at UTC midnight", () => {
    // 19:00 to 23:00 New York (EDT) is 23:00Z to 03:00Z: the anchor splits at 00:00Z and the next piece starts its
    // grid there; 23:45Z still fits because containment runs to 03:00Z.
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 45, durationMinutes: 30, rangeZone: UTC }),
        hosts: [host("h", { schedule: schedule(NY, weekly({ tue: [["19:00", "23:00"]] })) })],
        query: { rangeStart: utc("2026-10-13T00:00:00Z"), rangeEnd: utc("2026-10-15T00:00:00Z") },
      }),
    );
    expect(r.slots.map((s) => isoOf(s.start))).toEqual([
      "2026-10-13T23:00:00Z",
      "2026-10-13T23:45:00Z",
      "2026-10-14T00:00:00Z",
      "2026-10-14T00:45:00Z",
      "2026-10-14T01:30:00Z",
      "2026-10-14T02:15:00Z",
    ]);
  });
});

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

describe("windows and limits across DST", () => {
  it("rolling calendar days keep the wall clock across the Berlin spring change (7 days at 08:00 on Mar 25)", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 15, rangeZone: BERLIN, dateRange: { type: "rolling", days: 7, mode: "calendar_days" } }),
        hosts: [host("h", { schedule: schedule(BERLIN, weekly({ all: [["08:00", "17:00"]] })) })],
        query: { ...dayRange("2026-04-01", BERLIN), now: at("2026-03-25 08:00", BERLIN) },
      }),
    );
    expect(startLocals(r, BERLIN)).toEqual(["2026-04-01 08:00"]);
  });

  it("rolling weekdays keep the wall clock across the New York fall change", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 60, rangeZone: NY, dateRange: { type: "rolling", days: 2, mode: "weekdays" } }),
        hosts: [host("h", { schedule: schedule(NY, weekly({ weekdays: [["09:00", "17:00"]] })) })],
        query: { rangeStart: at("2026-10-30 00:00", NY), rangeEnd: at("2026-11-04 00:00", NY), now: at("2026-10-30 11:00", NY) },
      }),
    );
    // Friday 11:00 plus 2 week days is Tuesday 11:00 (EST now).
    expect(startLocals(r, NY).at(-1)).toBe("2026-11-03 11:00");
  });

  it("daily limits count the local day of the range zone on a 25-hour day", () => {
    const meetings = [{ start: at("2026-11-01 23:30", NY), meetingId: "late" }];
    const r = computeSlots(
      input({
        rules: rules({ rangeZone: NY, limits: { day: 1 }, eventTypeMeetingStarts: meetings }),
        hosts: [host("h", { schedule: schedule(NY, weekly({ all: [["09:00", "11:00"]] })) })],
        query: { rangeStart: at("2026-11-01 00:00", NY), rangeEnd: at("2026-11-03 00:00", NY) },
      }),
    );
    expect(startLocals(r, NY).map((l) => l.slice(0, 10))).toEqual(["2026-11-02", "2026-11-02", "2026-11-02", "2026-11-02"]);
  });
});
