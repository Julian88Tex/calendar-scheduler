// GEN-07 engine performance budget: 31 days with 15-minute increments for a 3-host round robin with 500 busy
// intervals per host computes in under 150ms on Node 22. The measurement takes the median of several warm runs so a
// shared machine's noise does not fail the suite. Set CI=1 and SLOW_MACHINE=1 to skip it on slow CI runners.
import { describe, expect, it } from "vitest";
import { computeSlots } from "@/lib/slots";
import type { BusyInterval, HostInput, SlotEngineInput } from "@/lib/slots";
import { LA, NY, at, host, rules, schedule, seededRandom, weekly } from "@/lib/slots/testing";

const BUDGET_MS = 150;
const skip = process.env.CI === "1" && process.env.SLOW_MACHINE === "1";

function benchInput(troubleshoot = false): SlotEngineInput {
  const rnd = seededRandom(42);
  const rangeStart = at("2026-10-01 00:00", LA);
  const rangeEnd = at("2026-11-01 00:00", LA); // 31 days
  const zones = [LA, NY, LA];
  const hosts: HostInput[] = zones.map((zone, i) => {
    const busy: BusyInterval[] = [];
    for (let b = 0; b < 500; b++) {
      const start = rangeStart - 86_400_000 + Math.floor(rnd() * 33 * 96) * 15 * 60_000;
      const len = (1 + Math.floor(rnd() * 8)) * 15 * 60_000;
      busy.push(
        b % 3 === 0
          ? { start: start - 900_000, end: start + len + 900_000, core: { start, end: start + len }, source: "meeting", meetingId: `m${i}-${b}`, eventTypeId: "other", title: "Meeting" }
          : { start, end: start + len, source: "calendar", title: b % 7 === 0 ? "Focus time" : "Busy", calendarId: "c" },
      );
    }
    return host(`h${i}`, {
      poolId: "pool",
      priority: 3,
      schedule: schedule(zone, weekly({ weekdays: [["08:00", "12:00"], ["13:00", "18:00"]], sat: [["10:00", "14:00"]] })),
      busy,
      hostLimitZone: zone,
      hostLimits: { week: 40 },
      hostMeetingStarts: busy.filter((x) => x.meetingId).map((x) => ({ start: x.core!.start, meetingId: x.meetingId! })),
      rr: { count: i, lastAssignedAt: null },
    });
  });
  return {
    rules: rules({
      durationMinutes: 30,
      incrementMinutes: 15,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 10,
      minimumNoticeMinutes: 240,
      rangeZone: LA,
      dateRange: { type: "rolling", days: 60, mode: "calendar_days" },
      limits: { day: 20 },
      pooling: "round_robin",
      pools: [{ id: "pool", distribution: "equal" }],
      freeBusyExceptions: [{ mode: "includes", text: "focus" }],
    }),
    hosts,
    query: { rangeStart, rangeEnd, now: at("2026-09-30 09:00", LA), troubleshoot },
  };
}

function medianMs(run: () => void, times = 7): number {
  run(); // warm up (JIT, zone offset tables)
  const samples: number[] = [];
  for (let i = 0; i < times; i++) {
    const t0 = performance.now();
    run();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

describe.skipIf(skip)("GEN-07 slot engine benchmark", () => {
  it(`31 days, 15-minute increments, 3 round robin hosts with 500 busy intervals each: under ${BUDGET_MS}ms`, () => {
    const i = benchInput();
    const result = computeSlots(i);
    expect(result.slots.length).toBeGreaterThan(500);
    const ms = medianMs(() => computeSlots(benchInput()));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("troubleshoot diagnostics for the same month stay within twice the budget", () => {
    const ms = medianMs(() => computeSlots(benchInput(true)), 3);
    expect(ms).toBeLessThan(BUDGET_MS * 2);
  });
});
