// Troubleshoot diagnostics (SCH-21): the reason code of every blocker type, including BUFFER when only buffers
// collide on either side (the candidate's core versus the blocker's core).
import { describe, expect, it } from "vitest";
import { computeSlots } from "@/lib/slots";
import type { CandidateDiagnostic, SlotEngineInput } from "@/lib/slots";
import { UTC, at, calendarBusy, dayRange, host, input, meetingBusy, reservedBusy, rules, schedule, weekly } from "./testing";

const day = "2026-10-13";
const t = (time: string, date = day) => at(`${date} ${time}`, UTC);
const nineToFive = (extra: Parameters<typeof schedule>[2] = {}) => schedule(UTC, weekly({ all: [["09:00", "17:00"]] }), extra);

function diagnose(i: SlotEngineInput): CandidateDiagnostic[] {
  const r = computeSlots({ ...i, query: { ...i.query, troubleshoot: true } });
  expect(r.diagnostics).toBeDefined();
  // Available diagnostics are exactly the slots.
  expect(r.diagnostics!.filter((d) => d.available).map((d) => d.start)).toEqual(r.slots.map((s) => s.start));
  return r.diagnostics!;
}

const at10 = (d: CandidateDiagnostic[], time = "10:00") => d.find((x) => x.start === t(time));

describe("SCH-21 reason codes per blocker type", () => {
  it("CALENDAR with the blocking event title and calendar", () => {
    const d = diagnose(
      input({
        rules: rules(),
        hosts: [host("h", { schedule: nineToFive(), busy: [calendarBusy(t("10:00"), t("11:00"), { title: "Dentist", calendarId: "cal-1" })] })],
        query: dayRange(day, UTC),
      }),
    );
    const c = at10(d)!;
    expect(c).toMatchObject({ available: false, reasons: ["CALENDAR"] });
    expect(c.hosts.h!.blockers).toEqual([{ source: "calendar", start: t("10:00"), end: t("11:00"), title: "Dentist", calendarId: "cal-1", code: "CALENDAR" }]);
    expect(at10(d, "11:00")).toMatchObject({ available: true, reasons: [] });
  });

  it("BUFFER, not CALENDAR, when only the candidate's own after-buffer reaches an external event", () => {
    const d = diagnose(
      input({
        rules: rules({ bufferAfterMinutes: 15 }),
        hosts: [host("h", { schedule: nineToFive(), busy: [calendarBusy(t("11:00"), t("12:00"))] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(at10(d, "10:30")!.reasons).toEqual(["BUFFER"]);
    expect(at10(d, "11:00")!.reasons).toEqual(["CALENDAR"]);
  });

  it("BUFFER, not EVENT or OVERLAP, when the candidate falls only inside another meeting's after-buffer or before-buffer", () => {
    const busy = [
      meetingBusy(t("10:00"), t("10:30"), { after: 15, eventTypeId: "et-1", meetingId: "same" }),
      meetingBusy(t("14:00"), t("14:30"), { before: 15, eventTypeId: "other", meetingId: "other" }),
    ];
    const d = diagnose(input({ rules: rules(), hosts: [host("h", { schedule: nineToFive(), busy })], query: dayRange(day, UTC) }));
    expect(at10(d, "10:00")!.reasons).toEqual(["EVENT"]);
    expect(at10(d, "10:30")!.reasons).toEqual(["BUFFER"]);
    expect(at10(d, "13:30")!.reasons).toEqual(["BUFFER"]);
    expect(at10(d, "14:00")!.reasons).toEqual(["OVERLAP"]);
    expect(at10(d, "13:30")!.hosts.h!.blockers.map((b) => b.meetingId)).toEqual(["other"]);
  });

  it("EVENT for a meeting of this event type, OVERLAP for another app meeting, RESERVED for holds", () => {
    const busy = [
      meetingBusy(t("09:00"), t("09:30"), { eventTypeId: "et-1" }),
      meetingBusy(t("09:30"), t("10:00"), { eventTypeId: "et-2" }),
      reservedBusy(t("10:00"), t("10:30"), { reservedKind: "poll" }),
    ];
    const d = diagnose(input({ rules: rules(), hosts: [host("h", { schedule: nineToFive(), busy })], query: dayRange(day, UTC) }));
    expect(at10(d, "09:00")!.reasons).toEqual(["EVENT"]);
    expect(at10(d, "09:30")!.reasons).toEqual(["OVERLAP"]);
    expect(at10(d, "10:00")!.reasons).toEqual(["RESERVED"]);
  });

  it("NOCAL for a host whose calendar cannot be read", () => {
    const d = diagnose(input({ rules: rules(), hosts: [host("h", { schedule: nineToFive(), calendarStatus: "nocal" })], query: dayRange(day, UTC) }));
    expect(d.every((c) => c.reasons.join() === "NOCAL")).toBe(true);
  });

  it("DAILY_MAX, WEEKLY_MAX and MONTHLY_MAX from event type limits", () => {
    const meetings = [{ start: t("08:00"), meetingId: "a" }];
    const run = (limits: Parameters<typeof rules>[0]) =>
      at10(diagnose(input({ rules: rules({ eventTypeMeetingStarts: meetings, ...limits }), hosts: [host("h", { schedule: nineToFive() })], query: dayRange(day, UTC) })))!;
    expect(run({ limits: { day: 1 } }).reasons).toEqual(["DAILY_MAX"]);
    expect(run({ limits: { week: 1 } }).reasons).toEqual(["WEEKLY_MAX"]);
    expect(run({ limits: { month: 1 } }).reasons).toEqual(["MONTHLY_MAX"]);
    expect(run({ limits: { day: 1, week: 1, month: 1 } }).reasons).toEqual(["DAILY_MAX", "WEEKLY_MAX", "MONTHLY_MAX"]);
  });

  it("MEETING_LIMIT from host limits", () => {
    const d = diagnose(
      input({
        rules: rules(),
        hosts: [host("h", { schedule: nineToFive(), hostLimits: { day: 1 }, hostMeetingStarts: [{ start: t("08:00"), meetingId: "x" }] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(at10(d)!.reasons).toEqual(["MEETING_LIMIT"]);
  });

  it("GROUP for a full group slot", () => {
    const d = diagnose(
      input({
        rules: rules({ kind: "group", seats: 2, groupSlots: [{ start: t("10:00"), end: t("10:30"), remaining: 0, meetingId: "g" }] }),
        hosts: [host("h", { schedule: nineToFive(), busy: [meetingBusy(t("10:00"), t("10:30"), { meetingId: "g", eventTypeId: "et-1", isFullGroupSlot: true })] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(at10(d)!.reasons).toEqual(["GROUP"]);
  });

  it("PAST, TOOSOON and RANGE from the booking window", () => {
    const d = diagnose(
      input({
        rules: rules({ minimumNoticeMinutes: 120, dateRange: { type: "fixed", startDate: day, endDate: day } }),
        hosts: [host("h", { schedule: nineToFive() })],
        query: { ...dayRange(day, UTC, 2), now: t("10:10") },
      }),
    );
    expect(at10(d, "10:00")!.reasons).toEqual(["PAST"]);
    expect(at10(d, "12:00")!.reasons).toEqual(["TOOSOON"]);
    expect(at10(d, "12:30")!.available).toBe(true);
    expect(d.find((c) => c.start === t("10:00", "2026-10-14"))!.reasons).toEqual(["RANGE"]);
  });

  it("HOLIDAY on a blocked date: diagnostics show the times the holiday removed", () => {
    const d = diagnose(input({ rules: rules(), hosts: [host("h", { schedule: nineToFive({ blockedDates: [day], overrides: { [day]: [{ start: 600, end: 660 }] } }) })], query: dayRange(day, UTC) }));
    // Holidays beat date-specific hours: the override's 10:00 to 11:00 is what the date would have offered.
    expect(d.map((c) => c.start)).toEqual([t("10:00"), t("10:30")]);
    expect(d.every((c) => !c.available && c.reasons.join() === "HOLIDAY" && c.hosts.h!.reasons.join() === "HOLIDAY")).toBe(true);
  });

  it("DURATION for an availability block shorter than the event", () => {
    const d = diagnose(input({ rules: rules({ durationMinutes: 30 }), hosts: [host("h", { schedule: schedule(UTC, weekly({ tue: [["09:00", "09:20"]] })) })], query: dayRange(day, UTC) }));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ start: t("09:00"), available: false, reasons: ["DURATION"] });
  });

  it("HOST for collective events, with each host's own reasons", () => {
    const d = diagnose(
      input({
        rules: rules({ pooling: "collective" }),
        hosts: [host("a", { schedule: nineToFive() }), host("b", { schedule: nineToFive(), busy: [calendarBusy(t("10:00"), t("10:30"))] })],
        query: dayRange(day, UTC),
      }),
    );
    const c = at10(d)!;
    expect(c.reasons).toEqual(["HOST"]);
    expect(c.hosts.a).toMatchObject({ available: true, reasons: [] });
    expect(c.hosts.b).toMatchObject({ available: false, reasons: ["CALENDAR"] });
  });

  it("ROUNDROBIN when no pool host is available, UNFAIR when equal distribution hides the available ones", () => {
    const pool = { pooling: "round_robin" as const, pools: [{ id: "p", distribution: "equal" as const }] };
    const d = diagnose(
      input({
        rules: rules(pool),
        hosts: [
          host("jim", { poolId: "p", schedule: nineToFive(), rr: { count: 5, lastAssignedAt: null }, busy: [calendarBusy(t("12:00"), t("13:00"))] }),
          host("karen", { poolId: "p", schedule: nineToFive(), rr: { count: 1, lastAssignedAt: null }, busy: [calendarBusy(t("10:00"), t("13:00"))] }),
        ],
        query: dayRange(day, UTC),
      }),
    );
    expect(at10(d)!.reasons).toEqual(["UNFAIR"]);
    expect(at10(d)!.hosts.jim).toMatchObject({ available: true });
    expect(at10(d, "12:00")!.reasons).toEqual(["ROUNDROBIN"]);
    expect(at10(d, "13:00")!.available).toBe(true);
  });

  it("a pool host outside its own hours is unavailable without a code, flagged outsideHours, while another host takes the time", () => {
    const d = diagnose(
      input({
        rules: rules({ pooling: "round_robin", pools: [{ id: "p", distribution: "availability" }] }),
        hosts: [host("a", { poolId: "p", schedule: schedule(UTC, weekly({ tue: [["09:00", "10:00"]] })) }), host("b", { poolId: "p", schedule: schedule(UTC, weekly({ tue: [["09:30", "11:00"]] })) })],
        query: dayRange(day, UTC),
      }),
    );
    expect(at10(d, "10:30")!.hosts.a).toEqual({ available: false, reasons: [], blockers: [], outsideHours: true });
    expect(at10(d, "10:30")!.hosts.b).toEqual({ available: true, reasons: [], blockers: [] });
    expect(at10(d, "10:30")!.available).toBe(true);
    expect(at10(d, "10:30")!.outsideHours).toBeUndefined();
  });

  it("free/busy exceptions and ignored meetings are not reported as blockers", () => {
    const d = diagnose(
      input({
        rules: rules({ freeBusyExceptions: [{ mode: "includes", text: "focus" }] }),
        hosts: [host("h", { schedule: nineToFive(), busy: [calendarBusy(t("10:00"), t("11:00"), { title: "Focus" }), meetingBusy(t("12:00"), t("12:30"), { meetingId: "moving" })] })],
        query: { ...dayRange(day, UTC), ignoreMeetingIds: ["moving"] },
      }),
    );
    expect(at10(d)!.available).toBe(true);
    expect(at10(d, "12:00")!.available).toBe(true);
  });

  it("several blockers give several codes sorted by display priority", () => {
    const d = diagnose(
      input({
        rules: rules({ bufferBeforeMinutes: 30 }),
        hosts: [host("h", { schedule: nineToFive(), busy: [calendarBusy(t("09:40"), t("09:50")), meetingBusy(t("10:10"), t("10:20"))] })],
        query: dayRange(day, UTC),
      }),
    );
    expect(at10(d)!.reasons).toEqual(["OVERLAP", "BUFFER"]);
    expect(at10(d)!.hosts.h!.blockers).toHaveLength(2);
  });
});

describe("Troubleshoot view details (owner priority 4)", () => {
  it("blockers carry their code, the named event's own times and the buffer side", () => {
    const busy = [
      meetingBusy(t("10:00"), t("10:30"), { before: 15, after: 15, title: "Intro call", meetingId: "intro", eventTypeId: "et-2" }),
      calendarBusy(t("12:00"), t("13:00"), { title: "Lunch with Sam", calendarId: "primary" }),
    ];
    const d = diagnose(input({ rules: rules({ incrementMinutes: 15, bufferAfterMinutes: 15 }), hosts: [host("h", { schedule: nineToFive(), busy })], query: dayRange(day, UTC) }));
    const after = at10(d, "10:30")!.hosts.h!.blockers;
    expect(after).toEqual([
      {
        source: "meeting",
        start: t("09:45"),
        end: t("10:45"),
        core: { start: t("10:00"), end: t("10:30") },
        code: "BUFFER",
        bufferSide: "before",
        title: "Intro call",
        meetingId: "intro",
        eventTypeId: "et-2",
      },
    ]);
    // 11:30 to 12:00 plus a 15 minute after-buffer reaches lunch: the blocker lies after the candidate.
    expect(at10(d, "11:30")!.hosts.h!.blockers).toEqual([
      { source: "calendar", start: t("12:00"), end: t("13:00"), code: "BUFFER", bufferSide: "after", title: "Lunch with Sam", calendarId: "primary" },
    ]);
    expect(at10(d, "12:00")!.hosts.h!.blockers[0]).toMatchObject({ code: "CALENDAR", title: "Lunch with Sam" });
    expect(at10(d, "10:00")!.hosts.h!.blockers[0]).toMatchObject({ code: "OVERLAP" });
  });

  it("limit periods say which daily, weekly or monthly limit is full (event type and host)", () => {
    const d = diagnose(
      input({
        rules: rules({ limits: { day: 5, week: 1 }, eventTypeMeetingStarts: [{ start: t("08:00", "2026-10-12"), meetingId: "a" }] }),
        hosts: [host("h", { schedule: nineToFive(), hostLimits: { day: 1, week: 9 }, hostMeetingStarts: [{ start: t("08:00"), meetingId: "b" }] })],
        query: dayRange(day, UTC),
      }),
    );
    const c = at10(d)!;
    expect(c.reasons).toEqual(["WEEKLY_MAX", "MEETING_LIMIT"]);
    expect(c.limitPeriods).toEqual(["week"]);
    expect(c.hosts.h!.limitPeriods).toEqual(["day"]);
  });

  it("diagnoseOutsideHours lists the rest of the day on a grid from local midnight, flagged outside working hours", () => {
    const base = {
      rules: rules({ incrementMinutes: 30, durationMinutes: 60 }),
      hosts: [host("h", { schedule: schedule(UTC, weekly({ tue: [["09:00", "12:00"]] })), busy: [calendarBusy(t("07:00"), t("08:00"), { title: "Gym" })] })],
    };
    const plain = diagnose(input({ ...base, query: dayRange(day, UTC) }));
    expect(plain.map((c) => c.start)).toEqual([t("09:00"), t("09:30"), t("10:00"), t("10:30"), t("11:00")]);
    const full = diagnose(input({ ...base, query: { ...dayRange(day, UTC), diagnoseOutsideHours: true } }));
    // Every half hour is listed once: 5 bookable grid times, 11:30 (inside the hours but too short: DURATION) and 42
    // times outside working hours.
    expect(full).toHaveLength(48);
    expect(full.filter((c) => c.outsideHours).length).toBe(48 - 6);
    const seven = full.find((c) => c.start === t("07:00"))!;
    expect(seven).toMatchObject({ outsideHours: true, available: false, reasons: ["CALENDAR"] });
    expect(seven.hosts.h!.blockers[0]).toMatchObject({ title: "Gym", code: "CALENDAR" });
    expect(full.find((c) => c.start === t("11:30"))).toMatchObject({ reasons: ["DURATION"], available: false });
    expect(full.find((c) => c.start === t("11:30"))!.outsideHours).toBeUndefined();
    expect(full.find((c) => c.start === t("09:00"))).toMatchObject({ available: true });
    expect(full.find((c) => c.start === t("12:00"))).toMatchObject({ outsideHours: true, reasons: [] });
  });

  it("outside-hours entries never duplicate grid times, and holiday hours stay HOLIDAY", () => {
    const d = diagnose(
      input({
        rules: rules({ incrementMinutes: 60 }),
        hosts: [host("h", { schedule: nineToFive({ blockedDates: [day] }) })],
        query: { ...dayRange(day, UTC), diagnoseOutsideHours: true },
      }),
    );
    expect(d).toHaveLength(24);
    expect(new Set(d.map((c) => c.start)).size).toBe(24);
    expect(d.filter((c) => c.reasons.includes("HOLIDAY")).map((c) => c.start)).toEqual([9, 10, 11, 12, 13, 14, 15, 16].map((h) => t(`${String(h).padStart(2, "0")}:00`)));
    expect(d.filter((c) => c.outsideHours)).toHaveLength(16);
  });

  it("outside-hours entries are not slots and are off by default", () => {
    const r = computeSlots(
      input({ rules: rules(), hosts: [host("h", { schedule: nineToFive() })], query: { ...dayRange(day, UTC), troubleshoot: true, diagnoseOutsideHours: true } }),
    );
    expect(r.slots).toHaveLength(16);
    expect(r.diagnostics!.filter((c) => c.available)).toHaveLength(16);
    expect(computeSlots(input({ rules: rules(), hosts: [host("h", { schedule: nineToFive() })], query: { ...dayRange(day, UTC), diagnoseOutsideHours: true } })).diagnostics).toBeUndefined();
  });
});
