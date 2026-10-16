// Property-based checks with a seeded generator (fast-check is not installed): for random schedules, busy times,
// buffers, increments, alignments, pooling types and zones, no returned slot overlaps a non-ignored busy interval of
// any eligible host (buffers included), every slot fits each eligible host's hours, slots are sorted and unique, the
// notice and range hold, troubleshoot availability equals the slots, and sub-range queries agree with the full range.
import { describe, expect, it } from "vitest";
import { computeSlots, matchesFreeBusyException, mergeIntervals } from "@/lib/slots";
import type { BusyInterval, EventTypeRules, HostInput, MinuteRange, SlotEngineInput } from "@/lib/slots";
import { dateIntervals } from "./schedule";
import { BERLIN, LA, NY, UTC, host, rules, seededRandom } from "./testing";
import { isoFromDay, zoneClock } from "./zone";

const ZONES = [UTC, LA, NY, BERLIN, "Asia/Kolkata", "Australia/Lord_Howe", "America/Santiago"];
const MIN = 60_000;

function scenario(seed: number): SlotEngineInput {
  const rnd = seededRandom(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
  const chance = (p: number) => rnd() < p;

  const rangeZone = pick(ZONES);
  const clock = zoneClock(rangeZone);
  // A random 9-day window in 2026 (covers DST dates often enough with many seeds).
  const firstDay = Date.UTC(2026, 0, 1) / 86_400_000 + int(0, 355);
  const rangeStart = clock.startOfDay(firstDay);
  const rangeEnd = clock.startOfDay(firstDay + 9);

  const randomRanges = (): MinuteRange[] => {
    const out: MinuteRange[] = [];
    const n = int(0, 3);
    for (let i = 0; i < n; i++) {
      const s = int(0, 95) * 15 + (chance(0.2) ? int(1, 14) : 0);
      const e = Math.min(1440, s + int(0, 48) * 15);
      out.push({ start: s, end: e });
    }
    return out;
  };

  const exceptions = chance(0.3) ? [{ mode: pick(["includes", "exact"] as const), text: pick(["focus", "Lunch", "gym"]) }] : [];
  const pooling = pick([null, null, "collective", "round_robin", "multi_pool"] as const);
  const pools = pooling === "round_robin" ? [{ id: "p1", distribution: pick(["availability", "equal"] as const) }]
    : pooling === "multi_pool" ? [{ id: "p1", distribution: "availability" as const }, { id: "p2", distribution: pick(["availability", "equal"] as const) }]
    : [];
  const hostCount = pooling === null ? 1 : int(2, 4);
  const hosts: HostInput[] = [];
  const meetingIds: string[] = [];
  for (let h = 0; h < hostCount; h++) {
    const zone = pick(ZONES);
    const hclock = zoneClock(zone);
    const weekly = Array.from({ length: 7 }, randomRanges) as unknown as NonNullable<HostInput["schedule"]>["weekly"];
    const overrides: Record<string, MinuteRange[]> = {};
    const blockedDates: string[] = [];
    const localFirst = hclock.localDay(rangeStart);
    for (let d = localFirst - 1; d <= localFirst + 10; d++) {
      if (chance(0.15)) overrides[isoFromDay(d)] = randomRanges();
      if (chance(0.05)) blockedDates.push(isoFromDay(d));
    }
    const busy: BusyInterval[] = [];
    const nBusy = int(0, 25);
    for (let b = 0; b < nBusy; b++) {
      const start = rangeStart + int(-24, 9 * 24 + 24) * 30 * MIN + (chance(0.3) ? int(1, 29) * MIN : 0);
      const len = chance(0.05) ? 24 * 60 * MIN : int(1, 12) * 15 * MIN;
      const kind = pick(["calendar", "meeting", "reserved"] as const);
      const title = chance(0.4) ? pick(["Focus time", "Lunch", "Gym", "lunch ", "Standup"]) : null;
      if (kind === "meeting") {
        const before = pick([0, 0, 15, 30]) * MIN;
        const after = pick([0, 0, 15, 30]) * MIN;
        const meetingId = `m${seed}-${h}-${b}`;
        meetingIds.push(meetingId);
        busy.push({ start: start - before, end: start + len + after, core: { start, end: start + len }, source: "meeting", meetingId, eventTypeId: pick(["et-1", "et-2"]), title, isFullGroupSlot: chance(0.1) });
      } else if (kind === "reserved") {
        busy.push({ start, end: start + len, source: "reserved", reservedKind: "reservation", reservationKey: `r${b}`, title });
      } else {
        busy.push({ start, end: start + len, source: "calendar", title, calendarId: "c" });
      }
    }
    const poolId = pooling === "round_robin" ? "p1" : pooling === "multi_pool" ? (h === 0 && chance(0.6) ? null : pick(["p1", "p2"])) : null;
    hosts.push(
      host(`h${h}`, {
        schedule: { timeZone: zone, weekly, overrides, blockedDates },
        busy,
        poolId,
        priority: pick([1, 2, 3, 4, 5] as const),
        rr: { count: int(0, 5), lastAssignedAt: chance(0.5) ? null : int(1, 1000) },
        hostLimitZone: zone,
        hostLimits: chance(0.2) ? { day: int(1, 3) } : {},
        hostMeetingStarts: meetingIds.slice(-3).map((id, i) => ({ start: rangeStart + i * 86_400_000, meetingId: id })),
        calendarStatus: chance(0.05) ? "nocal" : "ok",
      }),
    );
  }
  const r: EventTypeRules = rules({
    durationMinutes: pick([15, 20, 30, 45, 60, 90, 120]),
    incrementMinutes: pick([5, 10, 15, 20, 25, 30, 45, 60]),
    alignment: pick(["interval_start", "hour"] as const),
    bufferBeforeMinutes: pick([0, 0, 10, 15, 30]),
    bufferAfterMinutes: pick([0, 0, 10, 15, 30]),
    minimumNoticeMinutes: pick([0, 60, 240]),
    dateRange: pick([{ type: "unlimited" as const }, { type: "rolling" as const, days: int(1, 10), mode: pick(["calendar_days", "weekdays", "available_days"] as const) }]),
    rangeZone,
    weekStart: pick([0, 1] as const),
    limits: chance(0.2) ? { day: int(1, 3) } : {},
    pooling,
    pools,
    freeBusyExceptions: exceptions,
  });
  const now = rangeStart + int(-48, 72) * 30 * MIN;
  const ignoreMeetingIds = meetingIds.length > 0 && chance(0.3) ? [pick(meetingIds)] : [];
  const ignoreReservationKeys = chance(0.2) ? ["r0"] : [];
  return { rules: r, hosts, query: { rangeStart, rangeEnd, now, ignoreMeetingIds, ignoreReservationKeys } };
}

function hostBusyIgnored(b: BusyInterval, i: SlotEngineInput): boolean {
  if (b.meetingId && i.query.ignoreMeetingIds?.includes(b.meetingId)) return true;
  if (b.source === "reserved") return !!b.reservationKey && !!i.query.ignoreReservationKeys?.includes(b.reservationKey);
  return !b.isFullGroupSlot && matchesFreeBusyException(b.title, i.rules.freeBusyExceptions);
}

function fitsHostHours(h: HostInput, start: number, end: number): boolean {
  const s = h.schedule!;
  const clock = zoneClock(s.timeZone);
  const d = clock.localDay(start);
  const all = [];
  for (let x = d - 1; x <= d + 2; x++) all.push(...dateIntervals(s, isoFromDay(x)));
  return mergeIntervals(all).some((i) => i.start <= start && i.end >= end);
}

describe("property: slots never overlap busy time of their eligible hosts", () => {
  it("holds for 200 random scenarios", () => {
    let totalSlots = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const i = scenario(seed);
      const result = computeSlots(i);
      const before = i.rules.bufferBeforeMinutes * MIN;
      const after = i.rules.bufferAfterMinutes * MIN;
      const earliest = i.query.now + i.rules.minimumNoticeMinutes * MIN;
      let prev = -Infinity;
      const fail = (msg: string) => expect.fail(`seed ${seed}: ${msg}`);
      for (const slot of result.slots) {
        totalSlots++;
        const at = new Date(slot.start).toISOString();
        if (!(slot.start > prev)) fail(`slots not sorted or duplicated at ${at}`);
        prev = slot.start;
        if (slot.start < Math.max(i.query.rangeStart, earliest) || slot.start >= i.query.rangeEnd) fail(`slot ${at} outside range or notice`);
        if (result.windowEnd !== null && slot.start >= result.windowEnd) fail(`slot ${at} after the window end`);
        if (slot.eligibleHostIds.length === 0) fail(`slot ${at} without hosts`);
        for (const id of slot.eligibleHostIds) {
          const h = i.hosts.find((x) => x.userId === id)!;
          if (h.calendarStatus !== "ok") fail(`nocal host ${id} eligible at ${at}`);
          if (!fitsHostHours(h, slot.start, slot.end)) fail(`slot ${at} outside the hours of ${id}`);
          for (const b of h.busy) {
            if (hostBusyIgnored(b, i)) continue;
            if (b.start < slot.end + after && b.end > slot.start - before) fail(`slot ${at} overlaps busy ${JSON.stringify(b)} of ${id}`);
          }
        }
        if (i.rules.pooling === "collective" || i.rules.pooling === null) {
          if (slot.eligibleHostIds.length !== i.hosts.length) fail(`collective slot ${at} without every host`);
        }
      }
      const diag = computeSlots({ ...i, query: { ...i.query, troubleshoot: true, diagnoseOutsideHours: seed % 2 === 0 } });
      const keys = diag.diagnostics!.map((d) => `${d.start}:${d.end}`);
      if (new Set(keys).size !== keys.length) fail("duplicate diagnostics");
      expect(diag.slots, `seed ${seed} troubleshoot slots`).toEqual(result.slots);
      expect(diag.diagnostics!.filter((d) => d.available).map((d) => d.start)).toEqual(result.slots.map((s) => s.start));
      expect(diag.windowEnd).toBe(result.windowEnd);
    }
    expect(totalSlots).toBeGreaterThan(700);
  });

  it("sub-range queries return exactly the full range's slots inside them", () => {
    for (let seed = 1000; seed < 1040; seed++) {
      const i = scenario(seed);
      const full = computeSlots(i).slots.map((s) => s.start);
      const mid = i.query.rangeStart + Math.floor((i.query.rangeEnd - i.query.rangeStart) / 2 / (15 * MIN)) * 15 * MIN + 7 * MIN;
      const a = computeSlots({ ...i, query: { ...i.query, rangeEnd: mid } }).slots.map((s) => s.start);
      const b = computeSlots({ ...i, query: { ...i.query, rangeStart: mid } }).slots.map((s) => s.start);
      expect([...a, ...b], `seed ${seed}`).toEqual(full);
    }
  });

  it("is deterministic (same input, same output)", () => {
    for (let seed = 2000; seed < 2020; seed++) {
      const i = scenario(seed);
      expect(computeSlots(i)).toEqual(computeSlots(scenario(seed)));
    }
  });
});
