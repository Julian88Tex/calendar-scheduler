// Differential test: computeSlots against a deliberately naive reference implementation (brute force, written straight
// from SPEC SCH-01, SCH-02, SCH-04, SCH-06 to SCH-10, SCH-15 and SCH-16) on seeded random single-host, collective and
// round robin scenarios across DST zones, with both alignments. The property test proves slots are never wrong; this one also
// proves no valid start is missing (completeness) and that the grid matches the spec's anchoring rule exactly.
import { describe, expect, it } from "vitest";
import { computeSlots } from "@/lib/slots";
import type { BusyInterval, EventTypeRules, HostInput, Interval, MinuteRange, SlotEngineInput } from "@/lib/slots";
import { BERLIN, LA, NY, UTC, host, rules, seededRandom } from "@/lib/slots/testing";
import { dayFromIso, isoFromDay, weekdayOfDay, zoneClock } from "@/lib/slots/zone";

const MIN = 60_000;
const DAY = 86_400_000;
const ZONES = [UTC, LA, NY, BERLIN, "Australia/Sydney", "Asia/Kolkata"];

/** Spec-level reference: every candidate is checked by brute force, no indexes, no clamping tricks. */
function reference(i: SlotEngineInput): number[] {
  const { rules: r, hosts, query } = i;
  const dur = r.durationMinutes * MIN;
  const inc = r.incrementMinutes * MIN;
  const clock = zoneClock(r.rangeZone);

  // Host blocks: per local date ranges (override, else weekly; holiday removes), zero length dropped.
  const hostBlocks = hosts.map((h) => {
    const s = h.schedule!;
    const hc = zoneClock(s.timeZone);
    const anchors: Interval[] = [];
    const firstDay = hc.localDay(query.rangeStart) - 2;
    const lastDay = hc.localDay(query.rangeEnd) + 2;
    for (let d = firstDay; d <= lastDay; d++) {
      const iso = isoFromDay(d);
      if (s.blockedDates.includes(iso)) continue;
      const ranges = (Object.prototype.hasOwnProperty.call(s.overrides, iso) ? s.overrides[iso] : s.weekly[weekdayOfDay(d)])!;
      const ivs = ranges
        .filter((x) => x.end > x.start)
        .map((x) => ({ start: hc.wallToUtc(d, x.start), end: x.end >= 1440 ? hc.startOfDay(d + 1) : hc.wallToUtc(d, x.end) }))
        .filter((x) => x.end > x.start)
        .sort((a, b) => a.start - b.start);
      // merge within the date
      for (const iv of ivs) {
        const last = anchors[anchors.length - 1];
        if (last && last.end >= iv.start && hc.localDay(last.start) === d) last.end = Math.max(last.end, iv.end);
        else anchors.push({ ...iv });
      }
    }
    const containment: Interval[] = [];
    for (const a of [...anchors].sort((x, y) => x.start - y.start)) {
      const last = containment[containment.length - 1];
      if (last && last.end >= a.start) last.end = Math.max(last.end, a.end);
      else containment.push({ ...a });
    }
    return { anchors, containment };
  });

  // Combined blocks (collective intersection) by brute force over minutes is too slow; intersect pairwise.
  const intersect = (a: Interval[], b: Interval[]) => {
    const out: Interval[] = [];
    for (const x of a) for (const y of b) {
      const s = Math.max(x.start, y.start);
      const e = Math.min(x.end, y.end);
      if (s < e) out.push({ start: s, end: e });
    }
    return out.sort((p, q) => p.start - q.start);
  };
  const union = (lists: Interval[][]) => {
    const all = lists.flat().map((x) => ({ ...x })).sort((p, q) => p.start - q.start);
    const out: Interval[] = [];
    for (const x of all) {
      const last = out[out.length - 1];
      if (last && last.end >= x.start) last.end = Math.max(last.end, x.end);
      else out.push(x);
    }
    return out;
  };
  const roundRobin = r.pooling === "round_robin";
  let anchors = roundRobin ? union(hostBlocks.map((b) => b.anchors)) : hostBlocks[0]!.anchors;
  let containment = roundRobin ? union(hostBlocks.map((b) => b.containment)) : hostBlocks[0]!.containment;
  if (!roundRobin) {
    for (const hb of hostBlocks.slice(1)) {
      anchors = intersect(anchors, hb.anchors);
      containment = intersect(containment, hb.containment);
    }
  }
  // merge containment (touching pieces join), split anchors at range zone midnights
  const mergedC: Interval[] = [];
  for (const c of containment) {
    const last = mergedC[mergedC.length - 1];
    if (last && last.end >= c.start) last.end = Math.max(last.end, c.end);
    else mergedC.push({ ...c });
  }
  const split: Interval[] = [];
  for (const a of anchors) {
    let s = a.start;
    while (s < a.end) {
      const next = clock.startOfDay(clock.localDay(s) + 1);
      const e = Math.min(a.end, next);
      split.push({ start: s, end: e });
      s = e;
    }
  }

  // Window.
  const earliest = query.now + r.minimumNoticeMinutes * MIN;
  let lastStart = Infinity;
  if (r.dateRange.type === "rolling" && r.dateRange.mode === "calendar_days") {
    lastStart = clock.fromNaive(clock.toNaive(query.now) + r.dateRange.days * DAY);
  }
  let fixedStart = -Infinity;
  let fixedEnd = Infinity;
  if (r.dateRange.type === "fixed") {
    fixedStart = clock.startOfDay(dayFromIso(r.dateRange.startDate));
    fixedEnd = clock.startOfDay(dayFromIso(r.dateRange.endDate) + 1);
  }

  const counts = (starts: { start: number }[], zone: string, ws: 0 | 1) => {
    const c = zoneClock(zone);
    return (t: number) => {
      const d = c.localDay(t);
      const wk = d - ((weekdayOfDay(d) - ws + 7) % 7);
      const ym = isoFromDay(d).slice(0, 7);
      let day = 0;
      let week = 0;
      let month = 0;
      for (const m of starts) {
        const md = c.localDay(m.start);
        if (md === d) day++;
        if (md - ((weekdayOfDay(md) - ws + 7) % 7) === wk) week++;
        if (isoFromDay(md).slice(0, 7) === ym) month++;
      }
      return { day, week, month };
    };
  };
  const etCount = counts(r.eventTypeMeetingStarts, r.rangeZone, r.weekStart);
  const limitHit = (lim: EventTypeRules["limits"], c: { day: number; week: number; month: number }) =>
    (lim.day != null && c.day >= lim.day) || (lim.week != null && c.week >= lim.week) || (lim.month != null && c.month >= lim.month);

  // Equal distribution hides a host 3 or more above the pool minimum (SCH-16).
  const minCount = Math.min(...hosts.map((h) => h.rr?.count ?? 0));
  const hidden = (h: HostInput) => r.pools[0]?.distribution === "equal" && (h.rr?.count ?? 0) - minCount >= 3;
  const starts: number[] = [];
  for (const b of split) {
    if (r.alignment === "hour") {
      // Every instant of the block whose local wall-clock minute of the day is a multiple of the increment.
      for (let s = b.start; s < b.end; s += MIN) {
        if (Math.round(clock.localMinutes(s)) % r.incrementMinutes === 0) starts.push(s);
      }
    } else {
      for (let s = b.start; s < b.end; s += inc) starts.push(s);
    }
  }
  const out: number[] = [];
  {
    for (const s of starts) {
      const e = s + dur;
      if (s < query.rangeStart || s >= query.rangeEnd) continue;
      if (!mergedC.some((c) => c.start <= s && e <= c.end)) continue;
      if (s < query.now || s < earliest || s > lastStart || s < fixedStart || s >= fixedEnd) continue;
      if (limitHit(r.limits, etCount(s))) continue;
      const hostOk = (h: HostInput, k: number) => {
        if (!hostBlocks[k]!.containment.some((c) => c.start <= s && e <= c.end)) return false;
        const ws = s - r.bufferBeforeMinutes * MIN;
        const we = e + r.bufferAfterMinutes * MIN;
        // Zero-length busy entries are empty sets ([t, t)): they block nothing (SCH-12 "zero length").
        if (h.busy.some((x) => x.end > x.start && x.start < we && x.end > ws)) return false;
        if (limitHit(h.hostLimits, counts(h.hostMeetingStarts, h.hostLimitZone, r.weekStart)(s))) return false;
        return true;
      };
      const ok = roundRobin ? hosts.some((h, k) => !hidden(h) && hostOk(h, k)) : hosts.every(hostOk);
      if (ok) out.push(s);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function scenario(seed: number): SlotEngineInput {
  const rnd = seededRandom(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
  const rangeZone = pick(ZONES);
  const clock = zoneClock(rangeZone);
  // Bias the start toward DST weeks of 2026 (Mar 8, Mar 29, Apr 5, Oct 4, Oct 25, Nov 1) half of the time.
  const dstDays = ["2026-03-06", "2026-03-27", "2026-04-03", "2026-10-02", "2026-10-23", "2026-10-30"].map(dayFromIso);
  const firstDay = rnd() < 0.5 ? pick(dstDays) : dayFromIso("2026-01-01") + int(0, 360);
  const rangeStart = clock.startOfDay(firstDay);
  const rangeEnd = clock.startOfDay(firstDay + int(1, 8));
  const ranges = (): MinuteRange[] => {
    const n = int(0, 3);
    const out: MinuteRange[] = [];
    let cursor = int(0, 20) * 30;
    for (let k = 0; k < n && cursor < 1440; k++) {
      const start = cursor + (rnd() < 0.2 ? int(1, 29) : 0);
      const end = Math.min(1440, start + int(0, 20) * 30);
      out.push({ start, end });
      cursor = end + (rnd() < 0.4 ? 0 : int(1, 6) * 30); // touching ranges sometimes
    }
    return out;
  };
  const pooling = pick([null, null, null, "collective", "round_robin"] as const);
  const hostCount = pooling === null ? 1 : int(2, 3);
  const hosts: HostInput[] = [];
  for (let h = 0; h < hostCount; h++) {
    const zone = pick(ZONES);
    const hc = zoneClock(zone);
    const overrides: Record<string, MinuteRange[]> = {};
    const blockedDates: string[] = [];
    for (let d = hc.localDay(rangeStart) - 1; d <= hc.localDay(rangeEnd) + 1; d++) {
      if (rnd() < 0.15) overrides[isoFromDay(d)] = ranges();
      if (rnd() < 0.05) blockedDates.push(isoFromDay(d));
    }
    const busy: BusyInterval[] = [];
    for (let b = int(0, 12); b > 0; b--) {
      const s = rangeStart - DAY + int(0, (rangeEnd - rangeStart + 2 * DAY) / (15 * MIN)) * 15 * MIN;
      busy.push({ start: s, end: s + int(0, 16) * 15 * MIN, source: rnd() < 0.5 ? "calendar" : "reserved" });
    }
    const starts = Array.from({ length: int(0, 6) }, (_, k) => ({ start: rangeStart + int(-10, 10) * DAY / 2 + k, meetingId: `h${h}m${k}` }));
    hosts.push(
      host(`h${h}`, {
        schedule: { timeZone: zone, weekly: Array.from({ length: 7 }, ranges) as never, overrides, blockedDates },
        busy,
        hostLimitZone: zone,
        hostLimits: rnd() < 0.3 ? { day: int(1, 3), week: rnd() < 0.5 ? int(1, 6) : null } : {},
        hostMeetingStarts: starts,
        poolId: pooling === "round_robin" ? "p" : null,
        rr: pooling === "round_robin" ? { count: int(0, 5), lastAssignedAt: null } : null,
      }),
    );
  }
  const dateRange: EventTypeRules["dateRange"] =
    rnd() < 0.3
      ? { type: "rolling", days: int(1, 6), mode: "calendar_days" }
      : rnd() < 0.2
        ? { type: "fixed", startDate: isoFromDay(firstDay + int(0, 2)), endDate: isoFromDay(firstDay + int(2, 6)) }
        : { type: "unlimited" };
  return {
    rules: rules({
      durationMinutes: pick([15, 30, 45, 60, 90, 120]),
      incrementMinutes: pick([5, 10, 15, 20, 25, 30, 45, 60]),
      bufferBeforeMinutes: pick([0, 0, 5, 15, 30]),
      bufferAfterMinutes: pick([0, 0, 10, 15, 45]),
      minimumNoticeMinutes: pick([0, 60, 240, 1440]),
      rangeZone,
      weekStart: pick([0, 1] as const),
      dateRange,
      limits: rnd() < 0.3 ? { day: int(1, 2), week: rnd() < 0.5 ? int(1, 5) : null, month: rnd() < 0.3 ? int(1, 8) : null } : {},
      eventTypeMeetingStarts: Array.from({ length: int(0, 5) }, (_, k) => ({ start: rangeStart + int(-8, 16) * DAY / 2, meetingId: `e${k}` })),
      alignment: rnd() < 0.3 ? "hour" : "interval_start",
      pooling,
      pools: pooling === "round_robin" ? [{ id: "p", distribution: pick(["availability", "equal"] as const) }] : [],
    }),
    hosts,
    query: { rangeStart, rangeEnd, now: rangeStart + int(-2, 30) * 3_600_000 },
  };
}

describe("computeSlots equals a brute-force reference", () => {
  it("on 400 seeded single-host, collective and round robin scenarios (DST weeks, overrides, holidays, busy, buffers, limits, windows, both alignments)", () => {
    for (let seed = 1; seed <= Number(process.env.ORACLE_SEEDS ?? 400); seed++) {
      const i = scenario(seed);
      const got = computeSlots(i).slots.map((s) => s.start);
      const ref = reference(i);
      if (JSON.stringify(got) !== JSON.stringify(ref) && process.env.ORACLE_DEBUG) {
        const z = i.rules.rangeZone;
        const fmt = (t: number) => new Date(t).toISOString() + " " + zoneClock(z).toNaive(t) / 1;
        console.log(seed, JSON.stringify({ rules: { ...i.rules }, hosts: i.hosts.map((h) => ({ ...h })), query: i.query }));
        console.log("extra", got.filter((x) => !ref.includes(x)).map(fmt), "missing", ref.filter((x) => !got.includes(x)).map(fmt));
      }
      expect(got, `seed ${seed}`).toEqual(ref);
    }
  });
});

describe("troubleshoot explains every unavailable time", () => {
  it("each unavailable diagnostic has a reason code or the outside working hours flag, and available ones equal the slots", () => {
    for (let seed = 1; seed <= Number(process.env.ORACLE_SEEDS ?? 400); seed++) {
      const i = scenario(seed);
      const r = computeSlots({ ...i, query: { ...i.query, troubleshoot: true, diagnoseOutsideHours: true } });
      const plain = computeSlots(i);
      expect(r.diagnostics!.filter((d) => d.available).map((d) => d.start), `seed ${seed}`).toEqual(plain.slots.map((s) => s.start));
      const unexplained = r.diagnostics!.filter((d) => !d.available && d.reasons.length === 0 && !d.outsideHours);
      if (unexplained.length > 0 && process.env.ORACLE_DEBUG) {
        console.log(seed, i.rules.pooling, JSON.stringify(unexplained.slice(0, 2)));
      }
      expect(unexplained, `seed ${seed}`).toEqual([]);
    }
  });
});
