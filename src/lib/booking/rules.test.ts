// Event type rules, durations and the BK-31 booking window short circuit.
import { describe, expect, it } from "vitest";
import { bookingWindow } from "@/lib/slots";
import { allowedDurationsOf, buildRules, dateRangeRuleOf, rangeOutsideWindow, resolveDuration } from "./rules";
import type { BookingTarget, EventTypeRow } from "./types";

function eventType(over: Partial<EventTypeRow> = {}): EventTypeRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-0000000000aa",
    ownerUserId: "00000000-0000-4000-8000-0000000000bb",
    teamId: null,
    scope: "personal",
    type: "standard",
    bookingMethod: "instant",
    kind: "solo",
    poolingType: null,
    name: "30 Minute Virtual",
    slug: "30min",
    durationMinutes: 30,
    durationOptions: null,
    slotIncrementMinutes: 15,
    slotAlignment: "interval_start",
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 15,
    minimumNoticeMinutes: 240,
    dateRangeType: "rolling",
    dateRangeDays: 60,
    dateRangeMode: "calendar_days",
    dateRangeStart: null,
    dateRangeEnd: null,
    limitPerDay: 2,
    limitPerWeek: null,
    limitPerMonth: null,
    maxInvitees: 1,
    freeBusyExceptions: [],
    organizerUserId: null,
    hosts: [],
    pools: [],
    questions: [],
    ...over,
  } as unknown as EventTypeRow;
}

const target = (over: Partial<EventTypeRow> = {}, overrides?: BookingTarget["overrides"]): BookingTarget => ({
  kind: "event_type",
  eventType: eventType(over),
  ...(overrides ? { overrides } : {}),
});

describe("durations (SCH-18)", () => {
  it("offers the default first and accepts only listed options", () => {
    const t = target({ durationMinutes: 30, durationOptions: [15, 30, 60] });
    expect(allowedDurationsOf(t)).toEqual([30, 15, 60]);
    expect(resolveDuration(t, undefined)).toBe(30);
    expect(resolveDuration(t, 60)).toBe(60);
    expect(resolveDuration(t, 45)).toBeNull();
  });

  it("single-use overrides replace the options; adhoc types accept any duration", () => {
    expect(allowedDurationsOf(target({ durationOptions: [15, 30] }, { durationMinutes: 50 }))).toEqual([50]);
    expect(resolveDuration(target({ type: "adhoc" }), 95)).toBe(95);
    expect(resolveDuration(target({ type: "adhoc" }), 0)).toBeNull();
  });
});

describe("dateRangeRuleOf", () => {
  it("maps rolling, fixed and unlimited ranges", () => {
    expect(dateRangeRuleOf(eventType())).toEqual({ type: "rolling", days: 60, mode: "calendar_days" });
    expect(dateRangeRuleOf(eventType({ dateRangeType: "fixed", dateRangeStart: "2026-10-20", dateRangeEnd: "2026-10-22" }))).toEqual({
      type: "fixed",
      startDate: "2026-10-20",
      endDate: "2026-10-22",
    });
    expect(dateRangeRuleOf(eventType({ dateRangeType: "unlimited" }))).toEqual({ type: "unlimited" });
  });
});

describe("buildRules", () => {
  it("snapshots buffers, limits, increments and notice; one-off and poll bookings use 0/0 buffers", () => {
    const base = { durationMinutes: 30, rangeZone: "America/Los_Angeles", weekStart: 0 as const, eventTypeMeetingStarts: [], groupSlots: [] };
    const r = buildRules({ target: target(), ...base });
    expect(r).toMatchObject({
      incrementMinutes: 15,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      minimumNoticeMinutes: 240,
      limits: { day: 2, week: null, month: null },
      organizerUserId: "00000000-0000-4000-8000-0000000000bb",
      kind: "solo",
      seats: 1,
    });
    const zero = buildRules({ target: target(), ...base, zeroBuffers: true, ignoreNoticeAndRange: true });
    expect(zero).toMatchObject({ bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minimumNoticeMinutes: 0, dateRange: { type: "unlimited" } });
  });
});

describe("rangeOutsideWindow (BK-31 short circuit)", () => {
  const now = Date.parse("2026-10-12T17:00:00Z");
  const rules = buildRules({
    target: target({ dateRangeDays: 7 }),
    durationMinutes: 30,
    rangeZone: "America/Los_Angeles",
    weekStart: 0,
    eventTypeMeetingStarts: [],
    groupSlots: [],
  });
  const w = bookingWindow({ rules, hosts: [], now });

  it("is true for a month beyond the rolling window and for the past", () => {
    expect(rangeOutsideWindow(w, Date.parse("2026-12-01T08:00:00Z"), Date.parse("2027-01-01T08:00:00Z"))).toBe(true);
    expect(rangeOutsideWindow(w, Date.parse("2026-09-01T07:00:00Z"), Date.parse("2026-10-01T07:00:00Z"))).toBe(true);
    // Ends before now + 4 hours of notice
    expect(rangeOutsideWindow(w, Date.parse("2026-10-12T07:00:00Z"), Date.parse("2026-10-12T20:00:00Z"))).toBe(true);
  });

  it("is false when the range overlaps the window", () => {
    expect(rangeOutsideWindow(w, Date.parse("2026-10-01T07:00:00Z"), Date.parse("2026-11-01T07:00:00Z"))).toBe(false);
    expect(rangeOutsideWindow(w, Date.parse("2026-10-19T07:00:00Z"), Date.parse("2026-10-20T07:00:00Z"))).toBe(false);
  });

  it("fixed ranges bound both sides", () => {
    const fixed = buildRules({
      target: target({ dateRangeType: "fixed", dateRangeStart: "2026-10-20", dateRangeEnd: "2026-10-22" }),
      durationMinutes: 30,
      rangeZone: "America/Los_Angeles",
      weekStart: 0,
      eventTypeMeetingStarts: [],
      groupSlots: [],
    });
    const fw = bookingWindow({ rules: fixed, hosts: [], now });
    expect(rangeOutsideWindow(fw, Date.parse("2026-10-13T07:00:00Z"), Date.parse("2026-10-20T07:00:00Z"))).toBe(true);
    expect(rangeOutsideWindow(fw, Date.parse("2026-10-23T07:00:00Z"), Date.parse("2026-10-30T07:00:00Z"))).toBe(true);
    expect(rangeOutsideWindow(fw, Date.parse("2026-10-21T07:00:00Z"), Date.parse("2026-10-22T07:00:00Z"))).toBe(false);
  });
});
