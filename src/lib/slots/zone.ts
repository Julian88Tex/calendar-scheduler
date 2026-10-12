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

type DayOffsets =
  | { kind: "constant"; offset: number }
  | { kind: "transition"; at: Millis; before: number; after: number }
  | { kind: "complex" };

const MAX_CACHED_DAYS = 20_000;

/**
 * Offsets and wall-clock conversion for one IANA zone. Obtain instances with `zoneClock(zone)` (memoized). Offsets are
 * minutes east of UTC (New York in winter: -300).
 */
export class ZoneClock {
  readonly zone: string;
  private readonly dtf: Intl.DateTimeFormat;
  private readonly days = new Map<number, DayOffsets>();

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

  private dayOffsets(utcDay: number): DayOffsets {
    const cached = this.days.get(utcDay);
    if (cached) return cached;
    const start = utcDay * DAY_MS;
    const end = start + DAY_MS - 1;
    const a = this.rawOffset(start);
    const b = this.rawOffset(end);
    const mid = this.rawOffset(start + DAY_MS / 2);
    let entry: DayOffsets;
    if (a === b && a === mid) {
      entry = { kind: "constant", offset: a };
    } else if (mid !== a && mid !== b) {
      entry = { kind: "complex" };
    } else {
      // Binary search the first minute with the new offset (transitions happen on whole minutes).
      let lo = 0; // minute index known to have offset a
      let hi = 1439; // minute index known to have offset b (end of day)
      if (this.rawOffset(start + hi * MINUTE_MS) !== b) {
        entry = { kind: "complex" };
      } else {
        while (hi - lo > 1) {
          const m = (lo + hi) >> 1;
          if (this.rawOffset(start + m * MINUTE_MS) === a) lo = m;
          else hi = m;
        }
        entry = { kind: "transition", at: start + hi * MINUTE_MS, before: a, after: b };
      }
    }
    if (this.days.size >= MAX_CACHED_DAYS) this.days.clear();
    this.days.set(utcDay, entry);
    return entry;
  }

  /** Offset of the zone at an instant, in minutes. */
  offset(ms: Millis): number {
    const entry = this.dayOffsets(Math.floor(ms / DAY_MS));
    if (entry.kind === "constant") return entry.offset;
    if (entry.kind === "transition") return ms < entry.at ? entry.before : entry.after;
    return this.rawOffset(ms);
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
