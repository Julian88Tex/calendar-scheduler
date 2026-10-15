// Interval math and busy normalization (ARCHITECTURE section 7.4), exported for the availability service.
//
// All intervals are half-open [start, end) in epoch milliseconds. Merging joins overlapping AND touching intervals
// (9:00 to 12:00 plus 12:00 to 17:00 is one block, SCH-01; duplicate busy blocks from two calendars become one,
// SCH-11). Intersections never merge their outputs, so pieces that only touch stay separate (anchor blocks keep their
// own grid). Pure, client and server safe.
import type { BusyInterval, Interval, Millis } from "./types";
import { isIsoDate, dayFromIso, zoneClock } from "./zone";

/** True for a finite, non-empty half-open interval. */
export function isNonEmptyInterval(i: Interval | null | undefined): i is Interval {
  return !!i && Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start;
}

/** Sort and merge overlapping or touching intervals; empty and invalid intervals are dropped. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter(isNonEmptyInterval).map((i) => ({ start: i.start, end: i.end }));
  sorted.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else {
      out.push(i);
    }
  }
  return out;
}

function sortedValid(list: readonly Interval[]): Interval[] {
  const out = list.filter(isNonEmptyInterval).map((i) => ({ start: i.start, end: i.end }));
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/**
 * Intersection of two lists of non-overlapping intervals (touching allowed; each list is sorted first). Outputs are
 * never merged, so touching inputs give touching (separate) outputs. Merge a list first when it may overlap itself.
 */
export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const x = sortedValid(a);
  const y = sortedValid(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const s = Math.max(x[i]!.start, y[j]!.start);
    const e = Math.min(x[i]!.end, y[j]!.end);
    if (s < e) out.push({ start: s, end: e });
    if (x[i]!.end < y[j]!.end) i++;
    else j++;
  }
  return out;
}

/** Intersection of several lists (an empty list of lists gives no intervals). */
export function intersectAll(lists: readonly (readonly Interval[])[]): Interval[] {
  if (lists.length === 0) return [];
  let acc = sortedValid(lists[0]!);
  for (let k = 1; k < lists.length && acc.length > 0; k++) acc = intersectIntervals(acc, lists[k]!);
  return acc;
}

/** Union of several lists, merged (overlapping and touching intervals join). */
export function unionIntervals(lists: readonly (readonly Interval[])[]): Interval[] {
  const all: Interval[] = [];
  for (const l of lists) for (const i of l) all.push(i);
  return mergeIntervals(all);
}

/** `a` minus `b` (both may be unsorted or overlapping); the result is merged. */
export function subtractIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const base = mergeIntervals(a);
  const cut = mergeIntervals(b);
  const out: Interval[] = [];
  let j = 0;
  for (const i of base) {
    let s = i.start;
    while (j < cut.length && cut[j]!.end <= s) j++;
    let k = j;
    while (k < cut.length && cut[k]!.start < i.end) {
      if (cut[k]!.start > s) out.push({ start: s, end: cut[k]!.start });
      s = Math.max(s, cut[k]!.end);
      if (s >= i.end) break;
      k++;
    }
    if (s < i.end) out.push({ start: s, end: i.end });
  }
  return out;
}

/**
 * Split intervals at every local midnight of `zone` (DST correct). Used on combined anchor blocks so the grid of a
 * date never depends on other dates (SCH-01 step 4).
 */
export function splitAtLocalMidnights(intervals: readonly Interval[], zone: string): Interval[] {
  const clock = zoneClock(zone);
  const out: Interval[] = [];
  for (const i of intervals) {
    if (!isNonEmptyInterval(i)) continue;
    let s = i.start;
    while (s < i.end) {
      const next = clock.startOfDay(clock.localDay(s) + 1);
      if (next <= s) {
        out.push({ start: s, end: i.end });
        break;
      }
      const e = Math.min(i.end, next);
      out.push({ start: s, end: e });
      s = e;
    }
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/**
 * The busy interval of an all-day event: local midnight of `dateStart` to local midnight of `dateEndExclusive` in
 * `zone` (SCH-12: all-day events are read by their calendar dates, never by provider UTC instants). An end on or
 * before the start means one day.
 */
export function expandAllDay(dateStart: string, dateEndExclusive: string, zone: string): Interval {
  if (!isIsoDate(dateStart)) throw new Error(`expandAllDay: invalid start date "${dateStart}"`);
  const clock = zoneClock(zone);
  const startDay = dayFromIso(dateStart);
  let endDay = isIsoDate(dateEndExclusive) ? dayFromIso(dateEndExclusive) : startDay + 1;
  if (endDay <= startDay) endDay = startDay + 1;
  return { start: clock.startOfDay(startDay), end: clock.startOfDay(endDay) };
}

export type FreeBusyException = { mode: "includes" | "exact"; text: string };

const fold = (s: string) => s.normalize("NFC").trim().toLocaleLowerCase("en-US");

/**
 * SCH-13: true when the title matches any exception (case-insensitive; `includes` = substring of the trimmed text,
 * `exact` = trimmed equality). Empty titles and empty exception texts never match.
 */
export function matchesFreeBusyException(
  title: string | null | undefined,
  exceptions: readonly FreeBusyException[] | null | undefined,
): boolean {
  if (!title || !exceptions || exceptions.length === 0) return false;
  const t = fold(title);
  if (!t) return false;
  for (const ex of exceptions) {
    if (!ex || typeof ex.text !== "string") continue;
    const x = fold(ex.text);
    if (!x) continue;
    if (ex.mode === "exact" ? t === x : t.includes(x)) return true;
  }
  return false;
}

/**
 * Additive SCH-13 input carried by a busy interval (not part of BusyInterval): `neverExempt` marks an interval whose
 * title is a label of ours rather than an event title (a free/busy only calendar's "Busy (Work)", kept for
 * troubleshoot), which no free/busy rule may ignore.
 */
export type FreeBusyRuleFlags = { neverExempt?: boolean };

/**
 * SCH-13 for one busy interval: calendar events and app meetings whose title matches an exception are ignored for the
 * event type being booked, except full group slots and intervals flagged neverExempt; holds (source "reserved") are
 * never exempt.
 */
export function isIgnoredByFreeBusyRules(
  busy: Pick<BusyInterval, "source" | "title" | "isFullGroupSlot"> & FreeBusyRuleFlags,
  exceptions: readonly FreeBusyException[] | null | undefined,
): boolean {
  if (busy.source === "reserved" || busy.isFullGroupSlot || busy.neverExempt === true) return false;
  return matchesFreeBusyException(busy.title, exceptions);
}

/** Busy intervals sorted by start with empty or invalid entries dropped (input is not mutated). */
export function normalizeBusy<T extends Interval>(busy: readonly T[]): T[] {
  const out = busy.filter(isNonEmptyInterval);
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/**
 * Overlap queries over one host's busy intervals: `anyOverlap` uses the merged list (fast path, O(log n));
 * `overlapping` returns the raw intervals (diagnostics) using a prefix maximum of ends, so long intervals such as
 * all-day blocks are found without scanning everything.
 */
export class BusyIndex {
  readonly raw: BusyInterval[];
  private readonly prefixMaxEnd: Float64Array;
  private readonly merged: Interval[];

  constructor(busy: readonly BusyInterval[]) {
    this.raw = normalizeBusy(busy);
    this.prefixMaxEnd = new Float64Array(this.raw.length);
    let max = -Infinity;
    for (let i = 0; i < this.raw.length; i++) {
      max = Math.max(max, this.raw[i]!.end);
      this.prefixMaxEnd[i] = max;
    }
    this.merged = mergeIntervals(this.raw);
  }

  get size(): number {
    return this.raw.length;
  }

  /** True when any busy interval overlaps [start, end). */
  anyOverlap(start: Millis, end: Millis): boolean {
    const m = this.merged;
    let lo = 0;
    let hi = m.length;
    // First merged interval whose end is after `start`.
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (m[mid]!.end <= start) lo = mid + 1;
      else hi = mid;
    }
    return lo < m.length && m[lo]!.start < end;
  }

  /** Raw busy intervals overlapping [start, end), sorted by start. */
  overlapping(start: Millis, end: Millis, skip?: (b: BusyInterval) => boolean): BusyInterval[] {
    const r = this.raw;
    // Last index with raw.start < end.
    let lo = 0;
    let hi = r.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (r[mid]!.start < end) lo = mid + 1;
      else hi = mid;
    }
    const out: BusyInterval[] = [];
    for (let i = lo - 1; i >= 0 && this.prefixMaxEnd[i]! > start; i--) {
      const b = r[i]!;
      if (b.end > start && !(skip && skip(b))) out.push(b);
    }
    out.reverse();
    return out;
  }

  /** True when any raw busy interval overlaps [start, end), ignoring the ones `skip` returns true for. */
  anyOverlapExcept(start: Millis, end: Millis, skip: (b: BusyInterval) => boolean): boolean {
    const r = this.raw;
    let lo = 0;
    let hi = r.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (r[mid]!.start < end) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo - 1; i >= 0 && this.prefixMaxEnd[i]! > start; i--) {
      const b = r[i]!;
      if (b.end > start && !skip(b)) return true;
    }
    return false;
  }
}
