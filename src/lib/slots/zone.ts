// Fast, deterministic time zone math for the slot engine (ARCHITECTURE section 7.5, SPEC GEN-06).
//
// The engine avoids luxon in its inner loops: offsets come from Intl (cached per zone and UTC day, with the exact
// transition instant found by binary search on DST days), local dates are integer day numbers (days since
// 1970-01-01 in local wall-clock terms) and wall-clock times convert to instants with explicit rules:
// - nonexistent local times (spring forward gap) shift forward by the gap (02:30 becomes 03:30 in New York);
// - ambiguous local times (fall back overlap) take the EARLIER instant (01:30 EDT, not 01:30 EST).
// Unlike luxon's DateTime.fromObject, whose choice for ambiguous times depends on the offset at the current clock
// time, these results never depend on when the code runs. Pure: no I/O, no clock reads. Client and server safe.
import type { Millis } from "./types";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** A local calendar date as days since 1970-01-01 (zone independent integer). */
export type DayNumber = number;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" to a day number; throws on malformed input. */
export function dayFromIso(date: string): DayNumber {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Invalid date "${date}" (expected YYYY-MM-DD)`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = ms / DAY_MS;
  // Reject impossible dates such as 2026-02-30 (Date.UTC would roll them over).
  if (isoFromDay(day) !== date) throw new Error(`Invalid date "${date}"`);
  return day;
}

/** True when the string is a real "YYYY-MM-DD" calendar date. */
export function isIsoDate(date: unknown): date is string {
  if (typeof date !== "string" || !ISO_DATE.test(date)) return false;
  try {
    dayFromIso(date);
    return true;
  } catch {
    return false;
  }
}

/** A day number to "YYYY-MM-DD". */
export function isoFromDay(day: DayNumber): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Day of week of a day number, 0 = Sunday ... 6 = Saturday (WeeklyHours index). 1970-01-01 was a Thursday. */
export function weekdayOfDay(day: DayNumber): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** Calendar year and month (1..12) of a day number. */
export function yearMonthOfDay(day: DayNumber): { year: number; month: number } {
  const d = new Date(day * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** The day number of the first day of the month containing `day`. */
export function startOfMonthDay(day: DayNumber): DayNumber {
  const { year, month } = yearMonthOfDay(day);
  return Date.UTC(year, month - 1, 1) / DAY_MS;
}

/** The day number of the first day of the month after the one containing `day`. */
export function startOfNextMonthDay(day: DayNumber): DayNumber {
  const { year, month } = yearMonthOfDay(day);
  return Date.UTC(year, month, 1) / DAY_MS;
}

/** The first day of the week containing `day` for a week start of 0 (Sunday) or 1 (Monday). */
export function startOfWeekDay(day: DayNumber, weekStart: 0 | 1): DayNumber {
  return day - ((weekdayOfDay(day) - weekStart + 7) % 7);
}

/** Offsets of one UTC calendar year: the offset at the year start and every transition inside the year. */
type YearTable = { start: Millis; end: Millis; base: number; at: number[]; offsets: number[] };

const WEEK_MS = 7 * DAY_MS;
const MAX_CACHED_YEARS = 400;

/**
 * Offsets and wall-clock conversion for one IANA zone. Obtain instances with `zoneClock(zone)` (memoized). Offsets are
 * minutes east of UTC (New York in winter: -300).
 */
export class ZoneClock {
  readonly zone: string;
  private readonly dtf: Intl.DateTimeFormat;
  private readonly years = new Map<number, YearTable>();
  private last: YearTable | null = null;

  constructor(zone: string) {
    this.zone = zone;
    try {
      this.dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        era: "short",
      });
    } catch {
      throw new Error(`Invalid time zone "${zone}"`);
    }
  }

  /** Exact offset from Intl (no cache). */
  private rawOffset(ms: Millis): number {
    const whole = Math.floor(ms / 1000) * 1000;
    const parts = this.dtf.formatToParts(new Date(whole));
    let year = 0;
    let month = 1;
    let day = 1;
    let hour = 0;
    let minute = 0;
    let second = 0;
    let bc = false;
    for (const p of parts) {
      switch (p.type) {
        case "year":
          year = Number(p.value);
          break;
        case "month":
          month = Number(p.value);
          break;
        case "day":
          day = Number(p.value);
          break;
        case "hour":
          hour = Number(p.value) % 24;
          break;
        case "minute":
          minute = Number(p.value);
          break;
        case "second":
          second = Number(p.value);
          break;
        case "era":
          bc = /^b/i.test(p.value);
          break;
      }
    }
    if (bc) year = 1 - year;
    const d = new Date(0);
    d.setUTCFullYear(year, month - 1, day);
    d.setUTCHours(hour, minute, second, 0);
    return (d.getTime() - whole) / MINUTE_MS;
  }

  /** First whole minute in (lo, hi] whose offset differs from `from` (the caller knows hi differs). */
  private findChange(lo: Millis, hi: Millis, from: number): Millis {
    let a = Math.floor(lo / MINUTE_MS); // minute index known to have offset `from`
    let b = Math.ceil(hi / MINUTE_MS); // minute index known to differ
    while (b - a > 1) {
      const m = Math.floor((a + b) / 2);
      if (this.rawOffset(m * MINUTE_MS) === from) a = m;
      else b = m;
    }
    return b * MINUTE_MS;
  }

  /**
   * The offset table of a UTC year: offsets are sampled weekly and every change is located to the minute (transitions
   * happen on whole minutes, months apart). Several changes inside one week are all found as long as the offset at the
   * end of the week differs from the start or from an intermediate change.
   */
  private yearTable(year: number): YearTable {
    const cached = this.years.get(year);
    if (cached) return cached;
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);
    const base = this.rawOffset(start);
    const at: number[] = [];
    const offsets: number[] = [];
    let prevT = start;
    let prevO = base;
    while (prevT < end) {
      const t = Math.min(prevT + WEEK_MS, end);
      const sample = t === end ? end - 1000 : t;
      const o = this.rawOffset(sample);
      let lo = prevT;
      let cur = prevO;
      while (o !== cur) {
        const change = this.findChange(lo, sample, cur);
        if (change > sample) break;
        cur = this.rawOffset(change);
        at.push(change);
        offsets.push(cur);
        lo = change;
      }
      prevT = t;
      prevO = o;
    }
    const table: YearTable = { start, end, base, at, offsets };
    if (this.years.size >= MAX_CACHED_YEARS) this.years.clear();
    this.years.set(year, table);
    return table;
  }

  /** Offset of the zone at an instant, in minutes. */
  offset(ms: Millis): number {
    let t = this.last;
    if (!t || ms < t.start || ms >= t.end) {
      t = this.yearTable(new Date(ms).getUTCFullYear());
      this.last = t;
    }
    const at = t.at;
    if (at.length === 0 || ms < at[0]!) return t.base;
    let lo = 0;
    let hi = at.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (at[mid]! <= ms) lo = mid;
      else hi = mid - 1;
    }
    return t.offsets[lo]!;
  }

  /** The local wall-clock time of an instant as "naive" milliseconds (the local time read as if it were UTC). */
  toNaive(ms: Millis): number {
    return ms + this.offset(ms) * MINUTE_MS;
  }

  /** The local date of an instant. */
  localDay(ms: Millis): DayNumber {
    return Math.floor(this.toNaive(ms) / DAY_MS);
  }

  /** Wall-clock minutes since local midnight of an instant (0..1439, fractional when the instant has seconds). */
  localMinutes(ms: Millis): number {
    const naive = this.toNaive(ms);
    return (naive - Math.floor(naive / DAY_MS) * DAY_MS) / MINUTE_MS;
  }

  /**
   * The instant of a naive local wall-clock time. Nonexistent times shift forward by the gap; ambiguous times take
   * the earlier instant.
   */
  fromNaive(naive: number): Millis {
    const before = this.offset(naive - DAY_MS);
    const after = this.offset(naive + DAY_MS);
    const u1 = naive - before * MINUTE_MS;
    const ok1 = this.offset(u1) === before;
    if (before === after) {
      if (ok1) return u1;
      // Two transitions within two days (practically never): fall back to the exact offset search.
      return this.fromNaiveSlow(naive);
    }
    const u2 = naive - after * MINUTE_MS;
    const ok2 = this.offset(u2) === after;
    if (ok1 && ok2) return Math.min(u1, u2); // ambiguous: earlier instant
    if (ok1) return u1;
    if (ok2) return u2;
    // Gap: read the wall time with the offset in force before the transition, which lands after it.
    return u1;
  }

  private fromNaiveSlow(naive: number): Millis {
    let u = naive - this.offset(naive) * MINUTE_MS;
    for (let i = 0; i < 4; i++) {
      const next = naive - this.offset(u) * MINUTE_MS;
      if (next === u) return u;
      u = next;
    }
    return u;
  }

  /** The instant of `minutes` after local midnight of `day` (1440 = next local midnight). */
  wallToUtc(day: DayNumber, minutes: number): Millis {
    return this.fromNaive(day * DAY_MS + minutes * MINUTE_MS);
  }

  /**
   * Every instant whose local wall-clock time is `minutes` after local midnight of `day`, sorted: none inside a
   * spring-forward gap, two inside a fall-back overlap (01:30 EDT and 01:30 EST), otherwise one. Grids that step in
   * wall-clock minutes use it so the repeated hour of a fall-back day keeps its starts.
   */
  wallToUtcAll(day: DayNumber, minutes: number): Millis[] {
    const naive = day * DAY_MS + minutes * MINUTE_MS;
    const before = this.offset(naive - DAY_MS);
    const after = this.offset(naive + DAY_MS);
    const out: Millis[] = [];
    for (const o of before === after ? [before] : [before, after]) {
      const u = naive - o * MINUTE_MS;
      if (this.offset(u) === o && !out.includes(u)) out.push(u);
    }
    if (out.length === 0 && before === after) {
      // Two transitions within two days (practically never): exact search, kept only when the wall time exists.
      const u = this.fromNaiveSlow(naive);
      if (this.toNaive(u) === naive) out.push(u);
    }
    return out.sort((a, b) => a - b);
  }

  /** True when the wall-clock time exists on that day (not inside a spring-forward gap). */
  wallTimeExists(day: DayNumber, minutes: number): boolean {
    const naive = day * DAY_MS + minutes * MINUTE_MS;
    return this.toNaive(this.fromNaive(naive)) === naive;
  }

  /** The instant of local midnight (or the first existing instant of the day when midnight is skipped). */
  startOfDay(day: DayNumber): Millis {
    return this.fromNaive(day * DAY_MS);
  }

  /** True when the zone's offset changes during the local day. */
  hasTransition(day: DayNumber): boolean {
    const a = this.startOfDay(day);
    const b = this.startOfDay(day + 1);
    return this.offset(a) !== this.offset(b - 1) || b - a !== DAY_MS;
  }

  /** The same local wall-clock time `days` local dates later (DST safe, SCH-02). */
  plusLocalDays(ms: Millis, days: number): Millis {
    return this.fromNaive(this.toNaive(ms) + days * DAY_MS);
  }
}

const clocks = new Map<string, ZoneClock>();

/** The memoized ZoneClock of an IANA zone (throws for an invalid zone). */
export function zoneClock(zone: string): ZoneClock {
  let clock = clocks.get(zone);
  if (!clock) {
    clock = new ZoneClock(zone);
    if (clocks.size > 500) clocks.clear();
    clocks.set(zone, clock);
  }
  return clock;
}

/** True when Intl accepts the zone. */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone) return false;
  try {
    zoneClock(zone);
    return true;
  } catch {
    return false;
  }
}
