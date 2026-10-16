// Booking window (SCH-02 to SCH-06): rolling calendar days by time of day (observed Calendly behavior), rolling
// weekdays, days with availability (pooling, the today rule, vacations), fixed and unlimited ranges.
import { describe, expect, it } from "vitest";
import { bookingWindow, computeSlots, inWindow, windowReasons } from "@/lib/slots";
import { LA, UTC, at, dayRange, host, input, rules, schedule, startLocals, weekly } from "./testing";

const allDay = (zone = LA) => schedule(zone, weekly({ all: [["00:00", "24:00"]] }));
const eightToFive = (zone = LA) => schedule(zone, weekly({ all: [["08:00", "17:00"]] }));

describe("SCH-02 rolling calendar days", () => {
  it("with N = 7 at 08:00 on Apr 16, 08:00 on Apr 23 is offered and 08:15 is not", () => {
    const now = at("2026-04-16 08:00", LA);
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 15, rangeZone: LA, dateRange: { type: "rolling", days: 7, mode: "calendar_days" } }),
        hosts: [host("h", { schedule: eightToFive() })],
        query: { ...dayRange("2026-04-23", LA), now },
      }),
    );
    expect(startLocals(r, LA)).toEqual(["2026-04-23 08:00"]);
    expect(r.windowEnd).toBe(at("2026-04-23 08:00", LA) + 1);
  });

  it("with N = 1 at 23:00 local, tomorrow's slots up to 23:00 are offered", () => {
    const now = at("2026-10-13 23:00", LA);
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 30, rangeZone: LA, dateRange: { type: "rolling", days: 1, mode: "calendar_days" } }),
        hosts: [host("h", { schedule: allDay() })],
        query: { ...dayRange("2026-10-14", LA), now },
      }),
    );
    const locals = startLocals(r, LA);
    expect(locals[0]).toBe("2026-10-14 00:00");
    expect(locals.at(-1)).toBe("2026-10-14 23:00");
  });

  it('"60 days" at 10:00 on Oct 12 allows starts up to 10:00 on Dec 11 (wall clock across the DST change)', () => {
    const w = bookingWindow({
      rules: rules({ rangeZone: LA, dateRange: { type: "rolling", days: 60, mode: "calendar_days" } }),
      hosts: [],
      now: at("2026-10-12 10:00", LA),
    });
    expect(w.end).toBe(at("2026-12-11 10:00", LA) + 1);
    expect(inWindow(at("2026-12-11 10:00", LA), w)).toBe(true);
    expect(inWindow(at("2026-12-11 10:15", LA), w)).toBe(false);
  });

  it("keeps seconds of now (a start equal to now + N days is in range)", () => {
    const now = at("2026-04-16 08:00", LA) + 30_000;
    const w = bookingWindow({ rules: rules({ rangeZone: LA, dateRange: { type: "rolling", days: 7, mode: "calendar_days" } }), hosts: [], now });
    expect(inWindow(at("2026-04-23 08:00", LA), w)).toBe(true);
  });
});

describe("SCH-03 rolling weekdays", () => {
  it("on a Wednesday at 10:00 with N = 5 week days, starts are allowed up to 10:00 the next Wednesday", () => {
    const now = at("2026-10-14 10:00", LA); // Wednesday
    const w = bookingWindow({ rules: rules({ rangeZone: LA, dateRange: { type: "rolling", days: 5, mode: "weekdays" } }), hosts: [], now });
    expect(w.end).toBe(at("2026-10-21 10:00", LA) + 1);
  });

  it("weekend dates inside the window stay bookable when they have availability", () => {
    const now = at("2026-10-16 09:00", LA); // Friday
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 60, rangeZone: LA, dateRange: { type: "rolling", days: 1, mode: "weekdays" } }),
        hosts: [host("h", { schedule: eightToFive() })],
        query: { rangeStart: at("2026-10-16 00:00", LA), rangeEnd: at("2026-10-20 00:00", LA), now },
      }),
    );
    const dates = [...new Set(startLocals(r, LA).map((l) => l.slice(0, 10)))];
    expect(dates).toEqual(["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]);
    expect(startLocals(r, LA).at(-1)).toBe("2026-10-19 09:00");
  });

  it("from a Saturday, 1 week day ends on Monday at the current time of day", () => {
    const w = bookingWindow({
      rules: rules({ rangeZone: LA, dateRange: { type: "rolling", days: 1, mode: "weekdays" } }),
      hosts: [],
      now: at("2026-10-17 15:30", LA),
    });
    expect(w.end).toBe(at("2026-10-19 15:30", LA) + 1);
  });
});

describe("SCH-03 rolling days with availability", () => {
  const weekdays9to5 = schedule(UTC, weekly({ weekdays: [["09:00", "17:00"]] }));

  it('"3 days with availability" at 16:00 when today ends at 17:00 and notice is 4 hours: today does not count', () => {
    const w = bookingWindow({
      rules: rules({ minimumNoticeMinutes: 240, dateRange: { type: "rolling", days: 3, mode: "available_days" } }),
      hosts: [host("h", { schedule: weekdays9to5 })],
      now: at("2026-10-13 16:00", UTC), // Tuesday
    });
    // Wed, Thu, Fri count: the window ends at the start of Saturday.
    expect(w.end).toBe(at("2026-10-17 00:00", UTC));
  });

  it("today counts when one of its intervals ends after now + notice", () => {
    const w = bookingWindow({
      rules: rules({ minimumNoticeMinutes: 60, dateRange: { type: "rolling", days: 3, mode: "available_days" } }),
      hosts: [host("h", { schedule: weekdays9to5 })],
      now: at("2026-10-13 15:00", UTC),
    });
    expect(w.end).toBe(at("2026-10-16 00:00", UTC));
  });

  it("weekends without hours are skipped while counting", () => {
    const w = bookingWindow({
      rules: rules({ dateRange: { type: "rolling", days: 2, mode: "available_days" } }),
      hosts: [host("h", { schedule: weekdays9to5 })],
      now: at("2026-10-16 18:00", UTC), // Friday after hours
    });
    expect(w.end).toBe(at("2026-10-21 00:00", UTC)); // Mon 19 and Tue 20
  });

  it("a vacation (unavailable overrides) extends the window by the same number of dates on every month page", () => {
    const vacation = { "2026-10-19": [], "2026-10-20": [], "2026-10-21": [] };
    const base = {
      rules: rules({ incrementMinutes: 60, dateRange: { type: "rolling", days: 10, mode: "available_days" } }),
      hosts: [host("h", { schedule: schedule(UTC, weekly({ weekdays: [["09:00", "17:00"]] }), { overrides: vacation }) })],
    };
    const now = at("2026-10-12 08:00", UTC); // Monday
    const oct = computeSlots(input({ ...base, query: { rangeStart: at("2026-10-01 00:00", UTC), rangeEnd: at("2026-11-01 00:00", UTC), now } }));
    const nov = computeSlots(input({ ...base, query: { rangeStart: at("2026-11-01 00:00", UTC), rangeEnd: at("2026-12-01 00:00", UTC), now } }));
    const narrow = computeSlots(input({ ...base, query: { ...dayRange("2026-10-13", UTC), now } }));
    // 10 weekdays from Mon Oct 12 skipping Oct 19 to 21: Oct 12-16, 22, 23, 26, 27, 28 -> ends at the start of Oct 29.
    expect(oct.windowEnd).toBe(at("2026-10-29 00:00", UTC));
    expect(nov.windowEnd).toBe(oct.windowEnd);
    expect(narrow.windowEnd).toBe(oct.windowEnd);
    expect(nov.slots).toEqual([]);
    expect(startLocals(oct, UTC).at(-1)).toBe("2026-10-28 16:00");
  });

  it("pooling: collective counts dates where every host is available, round robin dates where any pool host is", () => {
    const a = host("a", { poolId: "p", schedule: schedule(UTC, weekly({ mon: [["09:00", "17:00"]], wed: [["09:00", "17:00"]] })) });
    const b = host("b", { poolId: "p", schedule: schedule(UTC, weekly({ wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]] })) });
    const now = at("2026-10-12 00:00", UTC); // Monday
    const collective = bookingWindow({
      rules: rules({ pooling: "collective", dateRange: { type: "rolling", days: 2, mode: "available_days" } }),
      hosts: [a, b],
      now,
    });
    expect(collective.end).toBe(at("2026-10-22 00:00", UTC)); // Wed 14 and Wed 21
    const roundRobin = bookingWindow({
      rules: rules({ pooling: "round_robin", pools: [{ id: "p", distribution: "availability" }], dateRange: { type: "rolling", days: 2, mode: "available_days" } }),
      hosts: [a, b],
      now,
    });
    expect(roundRobin.end).toBe(at("2026-10-15 00:00", UTC)); // Mon 12 and Wed 14
  });

  it("holidays (blocked dates) do not count", () => {
    const w = bookingWindow({
      rules: rules({ dateRange: { type: "rolling", days: 1, mode: "available_days" } }),
      hosts: [host("h", { schedule: schedule(UTC, weekly({ weekdays: [["09:00", "17:00"]] }), { blockedDates: ["2026-10-12"] }) })],
      now: at("2026-10-12 00:00", UTC),
    });
    expect(w.end).toBe(at("2026-10-14 00:00", UTC));
  });

  it("stops after 3,650 dates when availability never appears", () => {
    const w = bookingWindow({
      rules: rules({ dateRange: { type: "rolling", days: 5, mode: "available_days" } }),
      hosts: [host("h", { schedule: schedule(UTC, weekly({})) })],
      now: at("2026-10-12 00:00", UTC),
    });
    expect(w.end).toBe(at("2036-10-09 00:00", UTC));
  });
});

describe("SCH-04 fixed and SCH-05 unlimited ranges", () => {
  it("a range Oct 20 to Oct 22 yields slots only on those three local dates", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 240, rangeZone: LA, dateRange: { type: "fixed", startDate: "2026-10-20", endDate: "2026-10-22" } }),
        hosts: [host("h", { schedule: eightToFive() })],
        query: { rangeStart: at("2026-10-01 00:00", LA), rangeEnd: at("2026-11-01 00:00", LA) },
      }),
    );
    expect([...new Set(startLocals(r, LA).map((l) => l.slice(0, 10)))]).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(r.windowEnd).toBe(at("2026-10-23 00:00", LA));
  });

  it("dates in the past simply yield no slots", () => {
    const r = computeSlots(
      input({
        rules: rules({ rangeZone: LA, dateRange: { type: "fixed", startDate: "2026-10-01", endDate: "2026-10-05" } }),
        hosts: [host("h", { schedule: eightToFive() })],
        query: { rangeStart: at("2026-10-01 00:00", LA), rangeEnd: at("2026-11-01 00:00", LA), now: at("2026-10-12 10:00", LA) },
      }),
    );
    expect(r.slots).toEqual([]);
  });

  it("an end before the start is an empty window", () => {
    const w = bookingWindow({ rules: rules({ dateRange: { type: "fixed", startDate: "2026-10-22", endDate: "2026-10-20" } }), hosts: [], now: 0 });
    expect(w.start).toBe(w.end);
  });

  it("a slots request for a month 2 years ahead returns slots when the range is indefinite", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 60, rangeZone: LA, dateRange: { type: "unlimited" } }),
        hosts: [host("h", { schedule: eightToFive() })],
        query: { rangeStart: at("2028-10-01 00:00", LA), rangeEnd: at("2028-11-01 00:00", LA), now: at("2026-10-12 10:00", LA) },
      }),
    );
    expect(r.slots.length).toBe(31 * 9); // 08:00 to 16:00 every day
    expect(r.windowEnd).toBeNull();
  });
});

describe("window reason codes", () => {
  it("PAST before now, TOOSOON before now + notice, RANGE outside the window", () => {
    const w = bookingWindow({
      rules: rules({ minimumNoticeMinutes: 60, dateRange: { type: "rolling", days: 1, mode: "calendar_days" } }),
      hosts: [],
      now: at("2026-10-12 10:00", UTC),
    });
    expect(windowReasons(at("2026-10-12 09:00", UTC), w)).toEqual(["PAST"]);
    expect(windowReasons(at("2026-10-12 10:30", UTC), w)).toEqual(["TOOSOON"]);
    expect(windowReasons(at("2026-10-12 11:00", UTC), w)).toEqual([]);
    expect(windowReasons(at("2026-10-13 10:00", UTC), w)).toEqual([]);
    expect(windowReasons(at("2026-10-13 10:30", UTC), w)).toEqual(["RANGE"]);
  });
});
