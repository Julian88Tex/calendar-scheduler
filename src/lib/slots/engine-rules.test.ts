// computeSlots rule scenarios: buffers (SCH-07), notice (SCH-06), limits (SCH-08, SCH-09), increments (SCH-10),
// busy sources (SCH-11), free/busy rules (SCH-13), group seats (SCH-14), collective (SCH-15), round robin (SCH-16),
// multiple pools (SCH-17), durations (SCH-18), holds (SCH-19), reschedule exclusion (SCH-24) and spots mode.
import { describe, expect, it } from "vitest";
import { computeSlots } from "@/lib/slots";
import type { HostInput, MeetingStart } from "@/lib/slots";
import {
  LA,
  NY,
  UTC,
  at,
  calendarBusy,
  dayRange,
  host,
  input,
  meetingBusy,
  reservedBusy,
  rules,
  schedule,
  startLocals,
  startTimes,
  timesBetween,
  weekly,
} from "./testing";

const nineToFive = (zone = UTC, extra: Parameters<typeof schedule>[2] = {}) => schedule(zone, weekly({ all: [["09:00", "17:00"]] }), extra);
const day = "2026-10-13"; // a Tuesday
const t = (time: string, date = day, zone = UTC) => at(`${date} ${time}`, zone);

describe("SCH-07 buffers", () => {
  it("stack: two 30-minute meetings with 15/15 buffers keep 30 minutes between them", () => {
    const busy = [meetingBusy(t("10:00"), t("10:30"), { before: 15, after: 15 })];
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 15, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 }),
        hosts: [host("h", { schedule: nineToFive(), busy })],
        query: dayRange(day, UTC),
      }),
    );
    const times = startTimes(r, UTC);
    expect(times).toContain("09:00");
    expect(times).not.toContain("09:15");
    expect(times).not.toContain("10:45");
    expect(times).toContain("11:00");
  });

  it("may extend outside working hours: a 16:30 slot with a 30-minute after buffer is bookable when hours end at 17:00", () => {
    const r = computeSlots(
      input({
        rules: rules({ bufferBeforeMinutes: 30, bufferAfterMinutes: 30 }),
        hosts: [host("h", { schedule: nineToFive() })],
        query: dayRange(day, UTC),
      }),
    );
    expect(startTimes(r, UTC)).toEqual(timesBetween("09:00", "16:30", 30));
  });

  it("external events are not expanded; only the candidate's own buffers apply", () => {
    const busy = [calendarBusy(t("10:00"), t("11:00"))];
    const noBuffers = computeSlots(input({ rules: rules({ incrementMinutes: 15 }), hosts: [host("h", { schedule: nineToFive(), busy })], query: dayRange(day, UTC) }));
    expect(startTimes(noBuffers, UTC)).toContain("09:30");
    expect(startTimes(noBuffers, UTC)).toContain("11:00");
    const buffered = computeSlots(
      input({
        rules: rules({ incrementMinutes: 15, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 }),
        hosts: [host("h", { schedule: nineToFive(), busy })],
        query: dayRange(day, UTC),
      }),
    );
    expect(startTimes(buffered, UTC)).not.toContain("09:30");
    expect(startTimes(buffered, UTC)).toContain("09:15");
    expect(startTimes(buffered, UTC)).not.toContain("11:00");
    expect(startTimes(buffered, UTC)).toContain("11:15");
  });

  it("holds are never buffered, but a candidate's own buffers may not overlap a hold", () => {
    const busy = [reservedBusy(t("10:00"), t("10:30"), { reservationKey: "r1" })];
    const plain = computeSlots(input({ rules: rules({ incrementMinutes: 15 }), hosts: [host("h", { schedule: nineToFive(), busy })], query: dayRange(day, UTC) }));
    expect(startTimes(plain, UTC)).toEqual(expect.arrayContaining(["09:30", "10:30"]));
    const buffered = computeSlots(
      input({
        rules: rules({ incrementMinutes: 15, bufferAfterMinutes: 15, bufferBeforeMinutes: 15 }),
        hosts: [host("h", { schedule: nineToFive(), busy })],
        query: dayRange(day, UTC),
      }),
    );
    expect(startTimes(buffered, UTC)).not.toContain("10:30");
    expect(startTimes(buffered, UTC)).toContain("10:45");
    expect(startTimes(buffered, UTC)).not.toContain("09:30");
    expect(startTimes(buffered, UTC)).toContain("09:15");
  });

  it("an app meeting marked free on the provider still blocks (it arrives as a meeting busy interval)", () => {
    const busy = [meetingBusy(t("12:00"), t("13:00"))];
    const r = computeSlots(input({ rules: rules(), hosts: [host("h", { schedule: nineToFive(), busy })], query: dayRange(day, UTC) }));
    expect(startTimes(r, UTC)).not.toContain("12:00");
    expect(startTimes(r, UTC)).not.toContain("12:30");
    expect(startTimes(r, UTC)).toContain("13:00");
  });
});

describe("SCH-06 minimum notice", () => {
  it("with notice 4 hours at 10:07, the first candidate today is the first increment at or after 14:07", () => {
    const r = computeSlots(
      input({
        rules: rules({ minimumNoticeMinutes: 240, incrementMinutes: 30 }),
        hosts: [host("h", { schedule: nineToFive() })],
        query: { ...dayRange(day, UTC), now: t("10:07") },
      }),
    );
    expect(startTimes(r, UTC)[0]).toBe("14:30");
    const r15 = computeSlots(
      input({
        rules: rules({ minimumNoticeMinutes: 240, incrementMinutes: 15 }),
        hosts: [host("h", { schedule: nineToFive() })],
        query: { ...dayRange(day, UTC), now: t("10:07") },
      }),
    );
    expect(startTimes(r15, UTC)[0]).toBe("14:15");
  });

  it("notice 0 still drops starts before now", () => {
    const r = computeSlots(input({ rules: rules(), hosts: [host("h", { schedule: nineToFive() })], query: { ...dayRange(day, UTC), now: t("12:00") } }));
    expect(startTimes(r, UTC)[0]).toBe("12:00");
  });
});

describe("SCH-10 increments and alignment", () => {
  it("interval_start anchors at the block start: a 9:05 block with 30-minute increments yields 9:05, 9:35, 10:05", () => {
    const r = computeSlots(
      input({ rules: rules({ incrementMinutes: 30 }), hosts: [host("h", { schedule: schedule(UTC, weekly({ tue: [["09:05", "11:00"]] })) })], query: dayRange(day, UTC) }),
    );
    expect(startTimes(r, UTC)).toEqual(["09:05", "09:35", "10:05"]);
  });

  it("hour alignment uses multiples of the increment since local midnight: 9:05 block yields 9:30, 10:00", () => {
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 30, alignment: "hour" }),
        hosts: [host("h", { schedule: schedule(UTC, weekly({ tue: [["09:05", "11:00"]] })) })],
        query: dayRange(day, UTC),
      }),
    );
    expect(startTimes(r, UTC)).toEqual(["09:30", "10:00", "10:30"]);
  });

  it("hour alignment is evaluated in the range zone", () => {
    // Schedule in Kolkata (+05:30), range zone UTC: 09:00 to 12:00 IST is 03:30Z to 06:30Z, so UTC-hour alignment
    // gives 04:00Z, 05:00Z and 06:00Z (06:00 + 30 minutes still fits).
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 60, alignment: "hour", rangeZone: UTC }),
        hosts: [host("h", { schedule: schedule("Asia/Kolkata", weekly({ tue: [["09:00", "12:00"]] })) })],
        query: dayRange(day, UTC),
      }),
    );
    expect(startTimes(r, UTC)).toEqual(["04:00", "05:00", "06:00"]);
  });

  it("an increment longer than the duration prevents back-to-back starts (15-minute event, 30-minute increments)", () => {
    const r = computeSlots(
      input({ rules: rules({ durationMinutes: 15, incrementMinutes: 30 }), hosts: [host("h", { schedule: schedule(UTC, weekly({ tue: [["09:00", "10:00"]] })) })], query: dayRange(day, UTC) }),
    );
    expect(startTimes(r, UTC)).toEqual(["09:00", "09:30"]);
  });

  it("no dynamic increments: starts do not shift to right after an existing meeting", () => {
    const busy = [calendarBusy(t("09:00"), t("09:20"))];
    const r = computeSlots(input({ rules: rules({ incrementMinutes: 30 }), hosts: [host("h", { schedule: nineToFive(), busy })], query: dayRange(day, UTC) }));
    expect(startTimes(r, UTC)[0]).toBe("09:30");
  });
});

describe("SCH-18 multiple durations", () => {
  it("a 60-minute choice offers fewer late-day starts than a 30-minute choice", () => {
    const run = (durationMinutes: number) =>
      computeSlots(input({ rules: rules({ durationMinutes }), hosts: [host("h", { schedule: nineToFive() })], query: dayRange(day, UTC) }));
    expect(startTimes(run(30), UTC).at(-1)).toBe("16:30");
    expect(startTimes(run(60), UTC).at(-1)).toBe("16:00");
    expect(run(60).slots.every((s) => s.end - s.start === 3_600_000)).toBe(true);
  });
});

const starts = (...times: [string, string?][]): MeetingStart[] => times.map(([time, date], i) => ({ start: t(time, date ?? day), meetingId: `m${i}` }));

describe("SCH-08 event type limits", () => {
  it("with a daily limit of 2 and two active bookings on Oct 13 no slots are offered that day; canceling one restores them", () => {
    const base = { hosts: [host("h", { schedule: nineToFive() })], query: dayRange(day, UTC, 2) };
    const full = computeSlots(input({ ...base, rules: rules({ limits: { day: 2 }, eventTypeMeetingStarts: starts(["09:00"], ["11:00"]) }) }));
    expect(startLocals(full, UTC).filter((l) => l.startsWith(day))).toEqual([]);
    expect(startLocals(full, UTC).filter((l) => l.startsWith("2026-10-14")).length).toBe(16);
    const one = computeSlots(input({ ...base, rules: rules({ limits: { day: 2 }, eventTypeMeetingStarts: starts(["09:00"]) }) }));
    expect(startLocals(one, UTC).filter((l) => l.startsWith(day)).length).toBe(16);
  });

  it("weekly limit 1 with a Sunday week start: a meeting on Sunday Nov 29 blocks Tuesday Dec 1 on the December page", () => {
    const meetings = [{ start: t("10:00", "2026-11-29"), meetingId: "nov29" }];
    const sunday = computeSlots(
      input({
        rules: rules({ limits: { week: 1 }, weekStart: 0, eventTypeMeetingStarts: meetings }),
        hosts: [host("h", { schedule: nineToFive() })],
        query: dayRange("2026-12-01", UTC),
      }),
    );
    expect(sunday.slots).toEqual([]);
    const monday = computeSlots(
      input({
        rules: rules({ limits: { week: 1 }, weekStart: 1, eventTypeMeetingStarts: meetings }),
        hosts: [host("h", { schedule: nineToFive() })],
        query: dayRange("2026-12-01", UTC),
      }),
    );
    expect(monday.slots.length).toBe(16);
  });

  it("weekly limits are counted across a month boundary (Monday week start, Wed Sep 30 blocks Fri Oct 2)", () => {
    const r = computeSlots(
      input({
        rules: rules({ limits: { week: 1 }, weekStart: 1, eventTypeMeetingStarts: [{ start: t("10:00", "2026-09-30"), meetingId: "a" }] }),
        hosts: [host("h", { schedule: nineToFive() })],
        query: dayRange("2026-10-01", UTC, 5),
      }),
    );
    const dates = new Set(startLocals(r, UTC).map((l) => l.slice(0, 10)));
    expect([...dates].sort()).toEqual(["2026-10-05"]);
  });

  it("monthly limits use calendar months in the range zone", () => {
    const meetings = [{ start: at("2026-10-31 23:30", LA), meetingId: "a" }]; // Nov 1 06:30Z, still October in LA
    const r = computeSlots(
      input({
        rules: rules({ limits: { month: 1 }, rangeZone: LA, eventTypeMeetingStarts: meetings }),
        hosts: [host("h", { schedule: schedule(LA, weekly({ all: [["09:00", "17:00"]] })) })],
        query: { rangeStart: at("2026-10-30 00:00", LA), rangeEnd: at("2026-11-03 00:00", LA) },
      }),
    );
    const dates = new Set(startLocals(r, LA).map((l) => l.slice(0, 10)));
    expect([...dates].sort()).toEqual(["2026-11-01", "2026-11-02"]);
  });

  it("group events count scheduled events, not seats (the same meeting id counts once)", () => {
    const meetings = [
      { start: t("09:00"), meetingId: "slot" },
      { start: t("09:00"), meetingId: "slot" },
    ];
    const r = computeSlots(
      input({ rules: rules({ limits: { day: 2 }, eventTypeMeetingStarts: meetings }), hosts: [host("h", { schedule: nineToFive() })], query: dayRange(day, UTC) }),
    );
    expect(r.slots.length).toBe(16);
  });

  it("ignoreLimits (one-off spots, poll bookings) skips event type and host limits", () => {
    const r = computeSlots(
      input({
        rules: rules({ limits: { day: 1 }, eventTypeMeetingStarts: starts(["09:00"]) }),
        hosts: [host("h", { schedule: nineToFive(), hostLimits: { day: 1 }, hostMeetingStarts: starts(["15:00"]) })],
        query: { ...dayRange(day, UTC), ignoreLimits: true },
      }),
    );
    expect(r.slots.length).toBe(16);
  });
});

describe("SCH-09 host limits", () => {
  const weekMeetings = (n: number): MeetingStart[] => Array.from({ length: n }, (_, i) => ({ start: t("08:00", `2026-10-1${1 + i}`), meetingId: `w${i}` }));

  it("a host with a weekly limit of 5 and 5 meetings this week gets no slots this week", () => {
    const r = computeSlots(
      input({
        rules: rules(),
        hosts: [host("h", { schedule: nineToFive(), hostLimits: { week: 5 }, hostLimitZone: UTC, hostMeetingStarts: weekMeetings(5) })],
        query: dayRange("2026-10-11", UTC, 14),
      }),
    );
    const dates = new Set(startLocals(r, UTC).map((l) => l.slice(0, 10)));
    expect([...dates].every((d) => d >= "2026-10-18")).toBe(true);
    expect(dates.size).toBe(7);
  });

  it("host limits use the host's zone and week start", () => {
    const meeting = [{ start: at("2026-10-18 23:00", LA), meetingId: "x" }]; // Sunday 23:00 in LA = Monday 06:00Z
    const run = (weekStart: 0 | 1) =>
      computeSlots(
        input({
          rules: rules({ rangeZone: LA }),
          hosts: [host("h", { schedule: schedule(LA, weekly({ all: [["09:00", "17:00"]] })), hostLimits: { week: 1 }, hostLimitZone: LA, weekStart, hostMeetingStarts: meeting })],
          query: { rangeStart: at("2026-10-19 00:00", LA), rangeEnd: at("2026-10-20 00:00", LA) },
        }),
      );
    // Sunday week start: the meeting is in the week of Oct 18 to 24, so Monday Oct 19 is blocked.
    expect(run(0).slots).toEqual([]);
    // Monday week start: the meeting belongs to the week of Oct 12 to 18.
    expect(run(1).slots.length).toBe(16);
  });

  it("round robin: a host at the limit is ineligible while others can take the slot", () => {
    const pool = "p1";
    const hosts = [
      host("a", { schedule: nineToFive(), poolId: pool, hostLimits: { day: 1 }, hostMeetingStarts: starts(["08:00"]) }),
      host("b", { schedule: nineToFive(), poolId: pool }),
    ];
    const r = computeSlots(input({ rules: rules({ pooling: "round_robin", pools: [{ id: pool, distribution: "availability" }] }), hosts, query: dayRange(day, UTC) }));
    expect(r.slots.length).toBe(16);
    expect(r.slots.every((s) => s.eligibleHostIds.join() === "b" && s.inviteesRemaining === 1)).toBe(true);
  });

  it("collective: any host at the limit blocks the slot", () => {
    const hosts = [host("a", { schedule: nineToFive(), hostLimits: { day: 1 }, hostMeetingStarts: starts(["08:00"]) }), host("b", { schedule: nineToFive() })];
    const r = computeSlots(input({ rules: rules({ pooling: "collective" }), hosts, query: dayRange(day, UTC) }));
    expect(r.slots).toEqual([]);
  });
});

describe("SCH-24 reschedule exclusion", () => {
  it("with a daily limit of 1, rescheduling the only meeting of the day still offers later times that day", () => {
    const own = meetingBusy(t("10:00"), t("10:30"), { meetingId: "moving", eventTypeId: "et-1" });
    const base = {
      rules: rules({ limits: { day: 1 }, eventTypeMeetingStarts: [{ start: t("10:00"), meetingId: "moving" }] }),
      hosts: [host("h", { schedule: nineToFive(), busy: [own], hostMeetingStarts: [{ start: t("10:00"), meetingId: "moving" }] })],
    };
    expect(computeSlots(input({ ...base, query: dayRange(day, UTC) })).slots).toEqual([]);
    const moved = computeSlots(input({ ...base, query: { ...dayRange(day, UTC), ignoreMeetingIds: ["moving"] } }));
    expect(startTimes(moved, UTC)).toEqual(timesBetween("09:00", "16:30", 30));
  });

  it("with a weekly host limit reached by the meeting itself, other times that week are offered", () => {
    const h = host("h", { schedule: nineToFive(), hostLimits: { week: 1 }, hostMeetingStarts: [{ start: t("10:00"), meetingId: "moving" }] });
    expect(computeSlots(input({ rules: rules(), hosts: [h], query: dayRange(day, UTC, 2) })).slots).toEqual([]);
    const moved = computeSlots(input({ rules: rules(), hosts: [h], query: { ...dayRange(day, UTC, 2), ignoreMeetingIds: ["moving"] } }));
    expect(moved.slots.length).toBe(32);
  });

  it("weekly event type limits ignore the moved meeting too", () => {
    const meetings = [{ start: t("10:00", "2026-10-12"), meetingId: "moving" }];
    const base = { rules: rules({ limits: { week: 1 }, eventTypeMeetingStarts: meetings }), hosts: [host("h", { schedule: nineToFive() })] };
    expect(computeSlots(input({ ...base, query: dayRange(day, UTC) })).slots).toEqual([]);
    expect(computeSlots(input({ ...base, query: { ...dayRange(day, UTC), ignoreMeetingIds: ["moving"] } })).slots).toHaveLength(16);
  });

  it("monthly event type limits ignore the moved meeting too", () => {
    const r = computeSlots(
      input({
        rules: rules({ limits: { month: 1 }, eventTypeMeetingStarts: [{ start: t("10:00", "2026-10-02"), meetingId: "moving" }] }),
        hosts: [host("h", { schedule: nineToFive() })],
        query: { ...dayRange(day, UTC), ignoreMeetingIds: ["moving"] },
      }),
    );
    expect(r.slots.length).toBe(16);
  });

  it("a round robin host who is 3 ahead only because of the moved meeting is not hidden (caller excludes it from rr.count)", () => {
    const pool = "p";
    const mk = (jim: number) => [
      host("jim", { schedule: nineToFive(), poolId: pool, rr: { count: jim, lastAssignedAt: null } }),
      host("karen", { schedule: nineToFive(), poolId: pool, rr: { count: 0, lastAssignedAt: null }, busy: [calendarBusy(t("00:00"), t("23:59"))] }),
    ];
    const r = (hosts: HostInput[]) => computeSlots(input({ rules: rules({ pooling: "round_robin", pools: [{ id: pool, distribution: "equal" }] }), hosts, query: dayRange(day, UTC) }));
    expect(r(mk(3)).slots).toEqual([]);
    expect(r(mk(2)).slots.length).toBe(16);
  });
});

describe("SCH-11 busy sources and NOCAL", () => {
  it("a host whose calendar status is nocal is unavailable", () => {
    const r = computeSlots(input({ rules: rules(), hosts: [host("h", { schedule: nineToFive(), calendarStatus: "nocal" })], query: dayRange(day, UTC) }));
    expect(r.slots).toEqual([]);
  });

  it("meetings of other hosts never block (busy is per host)", () => {
    const hosts = [host("a", { schedule: nineToFive(), poolId: "p" }), host("b", { schedule: nineToFive(), poolId: "p", busy: [calendarBusy(t("09:00"), t("17:00"))] })];
    const r = computeSlots(input({ rules: rules({ pooling: "round_robin", pools: [{ id: "p", distribution: "availability" }] }), hosts, query: dayRange(day, UTC) }));
    expect(r.slots.length).toBe(16);
    expect(r.slots[0]!.eligibleByPool).toEqual({ p: ["a"] });
  });

  it("ignoreReservationKeys skips the invitee's own hold (retrying payment)", () => {
    const busy = [reservedBusy(t("10:00"), t("10:30"), { reservationKey: "mine" }), reservedBusy(t("11:00"), t("11:30"), { reservationKey: "other" })];
    const r = computeSlots(input({ rules: rules(), hosts: [host("h", { schedule: nineToFive(), busy })], query: { ...dayRange(day, UTC), ignoreReservationKeys: ["mine"] } }));
    expect(startTimes(r, UTC)).toContain("10:00");
    expect(startTimes(r, UTC)).not.toContain("11:00");
  });
});

describe("SCH-13 free/busy rules", () => {
  it('with exception "Includes: Focus", a slot overlapping an external "Focus time" event is offered', () => {
    const busy = [calendarBusy(t("10:00"), t("11:00"), { title: "Focus time" }), calendarBusy(t("13:00"), t("14:00"), { title: "Lunch" })];
    const r = computeSlots(
      input({ rules: rules({ freeBusyExceptions: [{ mode: "includes", text: "focus" }] }), hosts: [host("h", { schedule: nineToFive(), busy })], query: dayRange(day, UTC) }),
    );
    expect(startTimes(r, UTC)).toContain("10:00");
    expect(startTimes(r, UTC)).not.toContain("13:00");
  });

  it("exact mode compares trimmed, case-insensitive titles and applies to app meetings by name", () => {
    const busy = [meetingBusy(t("10:00"), t("11:00"), { title: "  Team Sync " }), meetingBusy(t("13:00"), t("14:00"), { title: "Team Sync extra" })];
    const r = computeSlots(
      input({ rules: rules({ freeBusyExceptions: [{ mode: "exact", text: "team sync" }] }), hosts: [host("h", { schedule: nineToFive(), busy })], query: dayRange(day, UTC) }),
    );
    expect(startTimes(r, UTC)).toContain("10:00");
    expect(startTimes(r, UTC)).not.toContain("13:00");
  });

  it("full group slots are never ignored, and holds are not affected", () => {
    const busy = [
      meetingBusy(t("10:00"), t("11:00"), { title: "Yoga class", isFullGroupSlot: true, eventTypeId: "group-et" }),
      meetingBusy(t("12:00"), t("13:00"), { title: "Yoga class", isFullGroupSlot: false, eventTypeId: "group-et" }),
      reservedBusy(t("15:00"), t("16:00"), { title: "Yoga hold" }),
    ];
    const r = computeSlots(
      input({ rules: rules({ freeBusyExceptions: [{ mode: "includes", text: "yoga" }] }), hosts: [host("h", { schedule: nineToFive(), busy })], query: dayRange(day, UTC) }),
    );
    expect(startTimes(r, UTC)).not.toContain("10:00");
    expect(startTimes(r, UTC)).toContain("12:00");
    expect(startTimes(r, UTC)).not.toContain("15:00");
  });
});

describe("SCH-14 group seats", () => {
  const groupRules = (extra: Parameters<typeof rules>[0] = {}) => rules({ kind: "group", seats: 3, ...extra });
  const slotMeeting = (time: string, id: string, extra: Parameters<typeof meetingBusy>[2] = {}) =>
    meetingBusy(t(time), t(time) + 30 * 60_000, { meetingId: id, eventTypeId: "et-1", ...extra });

  it("a group with 3 seats and 2 booked shows 1 spot left and joins the existing meeting", () => {
    const r = computeSlots(
      input({
        rules: groupRules({ groupSlots: [{ start: t("10:00"), end: t("10:30"), remaining: 1, meetingId: "g1" }] }),
        hosts: [host("h", { schedule: nineToFive(), busy: [slotMeeting("10:00", "g1")] })],
        query: dayRange(day, UTC),
      }),
    );
    const ten = r.slots.find((s) => s.start === t("10:00"));
    expect(ten).toMatchObject({ inviteesRemaining: 1, existingMeetingId: "g1" });
    // A fresh start gets every seat.
    expect(r.slots.find((s) => s.start === t("11:00"))?.inviteesRemaining).toBe(3);
    expect(r.slots.find((s) => s.start === t("09:30"))?.existingMeetingId).toBeUndefined();
  });

  it("starts overlapping an existing slot (other than the slot itself) are blocked by it", () => {
    const r = computeSlots(
      input({
        rules: groupRules({ incrementMinutes: 15, groupSlots: [{ start: t("10:00"), end: t("10:30"), remaining: 1, meetingId: "g1" }] }),
        hosts: [host("h", { schedule: nineToFive(), busy: [slotMeeting("10:00", "g1")] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(startTimes(r, UTC)).toEqual(expect.arrayContaining(["09:30", "10:00", "10:30"]));
    expect(startTimes(r, UTC)).not.toContain("09:45");
    expect(startTimes(r, UTC)).not.toContain("10:15");
  });

  it("with 2 booked and 1 pending hold the slot is full and not offered", () => {
    const r = computeSlots(
      input({
        rules: groupRules({ groupSlots: [{ start: t("10:00"), end: t("10:30"), remaining: 0, meetingId: "g1" }] }),
        hosts: [host("h", { schedule: nineToFive(), busy: [slotMeeting("10:00", "g1", { isFullGroupSlot: true })] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(r.slots.find((s) => s.start === t("10:00"))).toBeUndefined();
  });

  it("hold-only entries (no meeting yet) cap the seats", () => {
    const r = computeSlots(
      input({
        rules: groupRules({ groupSlots: [{ start: t("10:00"), end: t("10:30"), remaining: 2, meetingId: null }, { start: t("11:00"), end: t("11:30"), remaining: 0, meetingId: null }] }),
        hosts: [host("h", { schedule: nineToFive() })],
        query: dayRange(day, UTC),
      }),
    );
    expect(r.slots.find((s) => s.start === t("10:00"))).toEqual(expect.objectContaining({ inviteesRemaining: 2 }));
    expect(r.slots.find((s) => s.start === t("10:00"))?.existingMeetingId).toBeUndefined();
    expect(r.slots.find((s) => s.start === t("11:00"))).toBeUndefined();
  });

  it("changing increments from 30 to 60 minutes keeps an existing 9:30 slot with seats bookable (off-grid slot)", () => {
    const r = computeSlots(
      input({
        rules: groupRules({ incrementMinutes: 60, groupSlots: [{ start: t("09:30"), end: t("10:00"), remaining: 2, meetingId: "g1" }] }),
        hosts: [host("h", { schedule: nineToFive(), busy: [slotMeeting("09:30", "g1")] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(startTimes(r, UTC).slice(0, 4)).toEqual(["09:00", "09:30", "10:00", "11:00"]);
    expect(r.slots.find((s) => s.start === t("09:30"))).toMatchObject({ existingMeetingId: "g1", inviteesRemaining: 2 });
  });

  it("an existing slot outside the host's hours or under another conflict stops new joins", () => {
    const outside = computeSlots(
      input({
        rules: groupRules({ groupSlots: [{ start: t("08:00"), end: t("08:30"), remaining: 2, meetingId: "g0" }] }),
        hosts: [host("h", { schedule: nineToFive(), busy: [slotMeeting("08:00", "g0")] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(outside.slots.find((s) => s.start === t("08:00"))).toBeUndefined();
    const conflict = computeSlots(
      input({
        rules: groupRules({ groupSlots: [{ start: t("10:00"), end: t("10:30"), remaining: 2, meetingId: "g1" }] }),
        hosts: [host("h", { schedule: nineToFive(), busy: [slotMeeting("10:00", "g1"), calendarBusy(t("10:15"), t("10:45"))] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(conflict.slots.find((s) => s.start === t("10:00"))).toBeUndefined();
  });

  it("an existing slot with a different duration is not joinable (and blocks as a meeting of this event type)", () => {
    const r = computeSlots(
      input({
        rules: groupRules({ groupSlots: [{ start: t("10:00"), end: t("11:00"), remaining: 2, meetingId: "g60" }] }),
        hosts: [host("h", { schedule: nineToFive(), busy: [meetingBusy(t("10:00"), t("11:00"), { meetingId: "g60", eventTypeId: "et-1" })] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(r.slots.find((s) => s.start === t("10:00"))).toBeUndefined();
    expect(r.slots.find((s) => s.start === t("10:30"))).toBeUndefined();
  });

  it("joining an existing slot does not re-apply limits (a join adds no meeting)", () => {
    const r = computeSlots(
      input({
        rules: groupRules({
          limits: { day: 1 },
          eventTypeMeetingStarts: [{ start: t("10:00"), meetingId: "g1" }],
          groupSlots: [{ start: t("10:00"), end: t("10:30"), remaining: 2, meetingId: "g1" }],
        }),
        hosts: [host("h", { schedule: nineToFive(), busy: [slotMeeting("10:00", "g1")], hostLimits: { day: 1 }, hostMeetingStarts: [{ start: t("10:00"), meetingId: "g1" }] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(startTimes(r, UTC)).toEqual(["10:00"]);
  });

  it("other event types see a group slot as busy", () => {
    const r = computeSlots(
      input({
        rules: rules({ eventTypeId: "solo-et" }),
        hosts: [host("h", { schedule: nineToFive(), busy: [slotMeeting("10:00", "g1")] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(startTimes(r, UTC)).not.toContain("10:00");
  });
});

describe("SCH-15 collective", () => {
  it("hosts A (9 to 12) and B (10 to 13) yield slots only from 10 to 12 minus the duration", () => {
    const hosts = [
      host("a", { schedule: schedule(UTC, weekly({ tue: [["09:00", "12:00"]] })) }),
      host("b", { schedule: schedule(UTC, weekly({ tue: [["10:00", "13:00"]] })) }),
    ];
    const r = computeSlots(input({ rules: rules({ pooling: "collective" }), hosts, query: dayRange(day, UTC) }));
    expect(startTimes(r, UTC)).toEqual(["10:00", "10:30", "11:00", "11:30"]);
    expect(r.slots[0]!.eligibleHostIds).toEqual(["a", "b"]);
    expect(r.slots[0]!.eligibleByPool).toEqual({ required: ["a", "b"] });
  });

  it("A 9:00-12:00 and B 9:15-12:00 with 30-minute increments yield 9:15, 9:45, 10:15 and no 9:30", () => {
    const hosts = [
      host("a", { schedule: schedule(UTC, weekly({ tue: [["09:00", "12:00"]] })) }),
      host("b", { schedule: schedule(UTC, weekly({ tue: [["09:15", "12:00"]] })) }),
    ];
    const r = computeSlots(input({ rules: rules({ pooling: "collective" }), hosts, query: dayRange(day, UTC) }));
    expect(startTimes(r, UTC)).toEqual(["09:15", "09:45", "10:15", "10:45", "11:15"]);
    expect(startTimes(r, UTC)).not.toContain("09:30");
  });

  it("hosts in different zones intersect in UTC (New York 9 to 5 and Los Angeles 9 to 5 overlap 12:00 to 17:00 New York)", () => {
    const hosts = [
      host("ny", { schedule: schedule(NY, weekly({ weekdays: [["09:00", "17:00"]] })) }),
      host("la", { schedule: schedule(LA, weekly({ weekdays: [["09:00", "17:00"]] })) }),
    ];
    const r = computeSlots(input({ rules: rules({ pooling: "collective", rangeZone: NY, durationMinutes: 60 }), hosts, query: dayRange(day, NY) }));
    expect(startTimes(r, NY)).toEqual(timesBetween("12:00", "16:00", 30));
  });

  it("any host busy gives no slot", () => {
    const hosts = [host("a", { schedule: nineToFive() }), host("b", { schedule: nineToFive(), busy: [calendarBusy(t("09:00"), t("16:00"))] })];
    const r = computeSlots(input({ rules: rules({ pooling: "collective" }), hosts, query: dayRange(day, UTC) }));
    expect(startTimes(r, UTC)).toEqual(["16:00", "16:30"]);
  });
});

describe("SCH-16 round robin", () => {
  const rr = (distribution: "availability" | "equal" = "availability") => rules({ pooling: "round_robin", pools: [{ id: "p", distribution }] });

  it("candidates come from the union of the pool's blocks with one grid per union block", () => {
    const hosts = [
      host("a", { poolId: "p", schedule: schedule(UTC, weekly({ tue: [["09:00", "10:00"]] })) }),
      host("b", { poolId: "p", schedule: schedule(UTC, weekly({ tue: [["09:15", "11:00"]] })) }),
    ];
    const r = computeSlots(input({ rules: rr(), hosts, query: dayRange(day, UTC) }));
    expect(startTimes(r, UTC)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect(r.slots.map((s) => s.eligibleHostIds)).toEqual([["a"], ["a", "b"], ["b"], ["b"]]);
    expect(r.slots.map((s) => s.inviteesRemaining)).toEqual([1, 2, 1, 1]);
  });

  it("slot capacity equals the number of eligible hosts", () => {
    const hosts = ["a", "b", "c"].map((id) => host(id, { poolId: "p", schedule: nineToFive() }));
    const r = computeSlots(input({ rules: rr(), hosts, query: dayRange(day, UTC) }));
    expect(r.slots[0]).toMatchObject({ inviteesRemaining: 3, eligibleByPool: { p: ["a", "b", "c"] } });
  });

  it("equal distribution hide/unhide sequence (Jim/Karen): 3 and 0 hides Jim, 3 and 1 shows him, 4 and 1 hides him again", () => {
    const run = (jim: number, karen: number) =>
      computeSlots(
        input({
          rules: rr("equal"),
          hosts: [
            host("jim", { poolId: "p", schedule: nineToFive(), rr: { count: jim, lastAssignedAt: null } }),
            host("karen", { poolId: "p", schedule: nineToFive(), rr: { count: karen, lastAssignedAt: null } }),
          ],
          query: dayRange(day, UTC),
        }),
      ).slots[0]!.eligibleByPool.p;
    expect(run(3, 0)).toEqual(["karen"]);
    expect(run(3, 1)).toEqual(["jim", "karen"]);
    expect(run(4, 1)).toEqual(["karen"]);
    expect(run(2, 0)).toEqual(["jim", "karen"]);
  });

  it("equal distribution: when every available host is hidden there is no slot (UNFAIR)", () => {
    const r = computeSlots(
      input({
        rules: rr("equal"),
        hosts: [
          host("jim", { poolId: "p", schedule: nineToFive(), rr: { count: 3, lastAssignedAt: null } }),
          host("karen", { poolId: "p", schedule: nineToFive(), rr: { count: 0, lastAssignedAt: null }, busy: [calendarBusy(t("09:00"), t("12:00"))] }),
        ],
        query: dayRange(day, UTC),
      }),
    );
    expect(startTimes(r, UTC)[0]).toBe("12:00");
    expect(r.slots.every((s) => s.eligibleHostIds.join() === "karen")).toBe(true);
  });

  it("a pending round robin hold on host A leaves host B bookable at the same time", () => {
    const hosts = [
      host("a", { poolId: "p", schedule: nineToFive(), busy: [reservedBusy(t("10:00"), t("10:30"), { reservationKey: "r" })] }),
      host("b", { poolId: "p", schedule: nineToFive() }),
    ];
    const r = computeSlots(input({ rules: rr(), hosts, query: dayRange(day, UTC) }));
    expect(r.slots.find((s) => s.start === t("10:00"))).toMatchObject({ eligibleHostIds: ["b"], inviteesRemaining: 1 });
  });
});

describe("SCH-17 multiple host pools", () => {
  const multi = rules({
    pooling: "multi_pool",
    pools: [
      { id: "p1", distribution: "availability" },
      { id: "p2", distribution: "availability" },
    ],
  });

  it("required A plus P1 {B, C} and P2 {D}: a slot where A and D are free but B and C are busy is not offered", () => {
    const hosts = [
      host("a", { schedule: nineToFive() }),
      host("b", { schedule: nineToFive(), poolId: "p1", busy: [calendarBusy(t("10:00"), t("11:00"))] }),
      host("c", { schedule: nineToFive(), poolId: "p1", busy: [calendarBusy(t("10:00"), t("11:00"))] }),
      host("d", { schedule: nineToFive(), poolId: "p2" }),
    ];
    const r = computeSlots(input({ rules: multi, hosts, query: dayRange(day, UTC) }));
    expect(startTimes(r, UTC)).not.toContain("10:00");
    expect(startTimes(r, UTC)).not.toContain("10:30");
    expect(r.slots.find((s) => s.start === t("09:00"))?.eligibleByPool).toEqual({ required: ["a"], p1: ["b", "c"], p2: ["d"] });
    expect(r.slots.find((s) => s.start === t("09:00"))?.inviteesRemaining).toBe(1);
  });

  it("the combined grid is the intersection of the required host with each pool's union", () => {
    const hosts = [
      host("a", { schedule: schedule(UTC, weekly({ tue: [["09:00", "13:00"]] })) }),
      host("b", { poolId: "p1", schedule: schedule(UTC, weekly({ tue: [["09:10", "10:00"]] })) }),
      host("c", { poolId: "p1", schedule: schedule(UTC, weekly({ tue: [["09:40", "12:00"]] })) }),
      host("d", { poolId: "p2", schedule: schedule(UTC, weekly({ tue: [["08:00", "11:00"]] })) }),
    ];
    const r = computeSlots(input({ rules: multi, hosts, query: dayRange(day, UTC) }));
    // A [9, 13) and P1 union [9:10, 12) and P2 [8, 11) intersect to [9:10, 11): grid anchored at 9:10.
    expect(startTimes(r, UTC)).toEqual(["09:10", "09:40", "10:10"]);
  });

  it("a pool without any member makes the event unschedulable", () => {
    const hosts = [host("a", { schedule: nineToFive() }), host("b", { schedule: nineToFive(), poolId: "p1" })];
    const r = computeSlots(input({ rules: multi, hosts, query: dayRange(day, UTC) }));
    expect(r.slots).toEqual([]);
  });
});

describe("spots mode (one-off meetings)", () => {
  it("ignoreLimits lets a one-off spot be booked at the limit; without it the limits apply", () => {
    const spots = [{ start: t("10:00"), end: t("10:30") }];
    const base = {
      rules: rules({ spots, limits: { day: 1 }, eventTypeMeetingStarts: starts(["08:00"]) }),
      hosts: [host("h", { schedule: null, hostLimits: { day: 1 }, hostMeetingStarts: starts(["07:00"]) })],
    };
    expect(computeSlots(input({ ...base, query: dayRange(day, UTC) })).slots).toEqual([]);
    expect(computeSlots(input({ ...base, query: { ...dayRange(day, UTC), ignoreLimits: true } })).slots.map((s) => s.start)).toEqual([t("10:00")]);
  });


  it("offers exactly the spot windows, ignores working hours, still checks busy", () => {
    const spots = [
      { start: t("07:00"), end: t("08:00") },
      { start: t("12:00"), end: t("12:45") },
      { start: t("12:00"), end: t("12:45") },
      { start: t("20:00"), end: t("20:30") },
    ];
    const r = computeSlots(
      input({
        rules: rules({ spots, durationMinutes: 30 }),
        hosts: [host("h", { schedule: null, busy: [calendarBusy(t("20:15"), t("21:00"))] })],
        query: { ...dayRange(day, UTC), ignoreLimits: true },
      }),
    );
    expect(r.slots.map((s) => [startTimes({ slots: [s], windowEnd: null }, UTC)[0], (s.end - s.start) / 60_000])).toEqual([
      ["07:00", 60],
      ["12:00", 45],
    ]);
  });
});

describe("input validation", () => {
  it("an empty or inverted range gives no slots but still reports the window end", () => {
    const r = computeSlots(
      input({ rules: rules({ dateRange: { type: "rolling", days: 7, mode: "calendar_days" } }), hosts: [host("h", { schedule: nineToFive() })], query: { rangeStart: t("12:00"), rangeEnd: t("09:00"), now: t("08:00") } }),
    );
    expect(r).toEqual({ slots: [], windowEnd: t("08:00", "2026-10-20") + 1 });
  });

  it("non-finite instants are a programming error", () => {
    expect(() => computeSlots(input({ rules: rules(), hosts: [], query: { rangeStart: Number.NaN, rangeEnd: t("09:00") } }))).toThrow(/finite/);
  });

  it("no hosts give no slots", () => {
    expect(computeSlots(input({ rules: rules(), hosts: [], query: dayRange(day, UTC) })).slots).toEqual([]);
  });

  it("an invalid schedule zone is rejected loudly instead of computing wrong times", () => {
    expect(() => computeSlots(input({ rules: rules(), hosts: [host("h", { schedule: schedule("Not/AZone", weekly({ all: [["09:00", "17:00"]] })) })], query: dayRange(day, UTC) }))).toThrow(
      /Invalid time zone/,
    );
  });
});
