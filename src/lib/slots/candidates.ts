// Candidate starts (SPEC SCH-10, SCH-14, SCH-01 step 4; ARCHITECTURE section 7.3 step 4).
//
// Grid starts come from the combined anchor blocks: `interval_start` (Calendly default) steps by the increment from
// each anchor block's start (a 9:05 block with 30 minute increments yields 9:05, 9:35, 10:05); `hour` (extension)
// uses local times of the range zone whose wall-clock minutes since local midnight are a multiple of the increment
// (9:05 block: 9:30, 10:00), stepping in wall-clock minutes and skipping nonexistent times. A start is kept while it
// is inside its anchor block and [start, start + duration) fits the combined containment block holding it, so a
// block can end with a meeting that crosses midnight into the next date's block. No dynamic increments: starts never
// shift to right after existing meetings. Existing group slots with the event's duration are always candidates, even
// off the current grid (SCH-14). Spots mode (one-off meetings) offers exactly the spot windows.
import { fitsInside } from "./blocks";
import type { Interval, Millis } from "./types";
import { MINUTE_MS, zoneClock } from "./zone";

export type CandidateOrigin = "grid" | "group" | "spot" | "holiday" | "duration" | "outside";
export type Candidate = { start: Millis; end: Millis; origin: CandidateOrigin };

export type GridOptions = {
  durationMs: number;
  incrementMinutes: number;
  alignment: "interval_start" | "hour";
  rangeZone: string;
  /** Inclusive lower bound of starts. */
  from: Millis;
  /** Exclusive upper bound of starts. */
  to: Millis;
};

/** Grid starts of the anchor blocks that fit their containment block, sorted and unique. */
export function gridStarts(anchors: readonly Interval[], containment: readonly Interval[], opts: GridOptions): Millis[] {
  const out: Millis[] = [];
  const inc = Math.max(1, opts.incrementMinutes);
  const incMs = inc * MINUTE_MS;
  const keep = (s: Millis) => {
    if (s < opts.from || s >= opts.to) return;
    if (!fitsInside(containment, s, s + opts.durationMs)) return;
    out.push(s);
  };
  if (opts.alignment === "hour") {
    const clock = zoneClock(opts.rangeZone);
    for (const b of anchors) {
      if (b.end <= opts.from || b.start >= opts.to) continue;
      const day = clock.localDay(b.start);
      const midnight = clock.startOfDay(day);
      const transition = clock.hasTransition(day);
      let local = Math.ceil(clock.localMinutes(b.start) / inc) * inc;
      if (!transition) {
        for (; local < 1440; local += inc) {
          const s = midnight + local * MINUTE_MS;
          if (s >= b.end || s >= opts.to) break;
          keep(s);
        }
      } else {
        // DST day: nonexistent wall times are skipped; a repeated wall time (fall back) is offered at both of its
        // instants, like the interval_start grid, so the repeated hour keeps its starts. The second occurrence of an
        // earlier wall time can lie after the block start, so the walk starts at midnight.
        for (local = 0; local < 1440; local += inc) {
          const all = clock.wallToUtcAll(day, local);
          if (all.length === 0) continue;
          if (all[0]! >= b.end || all[0]! >= opts.to) break;
          for (const s of all) if (s >= b.start && s < b.end && s < opts.to) keep(s);
        }
      }
    }
  } else {
    for (const b of anchors) {
      if (b.end <= opts.from || b.start >= opts.to) continue;
      const k0 = b.start >= opts.from ? 0 : Math.ceil((opts.from - b.start) / incMs);
      for (let s = b.start + k0 * incMs; s < b.end && s < opts.to; s += incMs) keep(s);
    }
  }
  out.sort((a, b) => a - b);
  return dedupeSorted(out);
}

function dedupeSorted(list: Millis[]): Millis[] {
  const out: Millis[] = [];
  for (const v of list) if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  return out;
}

/**
 * Troubleshoot DURATION context: one diagnostic start per combined containment block shorter than the duration (at
 * the block start), within [from, to).
 */
export function shortBlockStarts(containment: readonly Interval[], durationMs: number, from: Millis, to: Millis): Millis[] {
  const out: Millis[] = [];
  for (const c of containment) {
    if (c.end - c.start < durationMs && c.start >= from && c.start < to) out.push(c.start);
  }
  return out;
}

/**
 * Troubleshoot "outside working hours" grid: every wall-clock multiple of the increment from local midnight of each
 * date of `zone` within [from, to), skipping nonexistent times (a repeated fall back wall time appears at both of its
 * instants, like the hour-aligned grid).
 */
export function dayGridStarts(zone: string, incrementMinutes: number, from: Millis, to: Millis): Millis[] {
  const clock = zoneClock(zone);
  const inc = Math.max(1, incrementMinutes);
  const out: Millis[] = [];
  for (let day = clock.localDay(from); clock.startOfDay(day) < to; day++) {
    const transition = clock.hasTransition(day);
    const midnight = clock.startOfDay(day);
    for (let local = 0; local < 1440; local += inc) {
      if (!transition) {
        const s = midnight + local * MINUTE_MS;
        if (s >= from && s < to) out.push(s);
        continue;
      }
      for (const s of clock.wallToUtcAll(day, local)) if (s >= from && s < to) out.push(s);
    }
  }
  out.sort((a, b) => a - b);
  return dedupeSorted(out);
}

/** Sorted, unique candidates; for equal start and end, real origins win over diagnostic-only ones. */
export function mergeCandidates(lists: readonly Candidate[][]): Candidate[] {
  const rank: Record<CandidateOrigin, number> = { grid: 0, group: 1, spot: 2, holiday: 3, duration: 4, outside: 5 };
  const all: Candidate[] = [];
  for (const l of lists) for (const c of l) all.push(c);
  all.sort((a, b) => a.start - b.start || a.end - b.end || rank[a.origin] - rank[b.origin]);
  const out: Candidate[] = [];
  for (const c of all) {
    const last = out[out.length - 1];
    if (last && last.start === c.start && last.end === c.end) continue;
    out.push(c);
  }
  return out;
}

/** Spot candidates within [from, to), unique by start and end. */
export function spotCandidates(spots: readonly Interval[], from: Millis, to: Millis): Candidate[] {
  const out: Candidate[] = [];
  for (const s of spots) {
    if (!s || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end <= s.start) continue;
    if (s.start < from || s.start >= to) continue;
    out.push({ start: s.start, end: s.end, origin: "spot" });
  }
  return out;
}
