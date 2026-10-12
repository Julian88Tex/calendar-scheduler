// Schedules to UTC availability intervals per local date (ARCHITECTURE section 7.3 step 2, SPEC SCH-01, AV-04,
// AV-06, AV-13, GEN-06).
//
// For each local date of the schedule's zone: a blocked date (observed holiday) has no intervals and beats
// date-specific hours; otherwise the date's override (an empty array means unavailable) replaces the weekday hours.
// Zero-length and inverted ranges are ignored (observed: "17:00-17:00" means unavailable). Minutes are wall-clock
// minutes from local midnight; 1440 is the next local midnight. Conversion is wall-clock math in the zone, so DST
// days keep 9:00 at 9:00; nonexistent local times shift forward and ambiguous ones take the earlier instant.
// Anchor blocks are the date's intervals merged (touching or overlapping); they never cross the date's midnight.
// Containment blocks merge anchor blocks across midnight (22:00 to 24:00 plus 00:00 to 02:00 is one block).
import { mergeIntervals } from "./busy";
import type { Interval, Millis, MinuteRange, ScheduleInput } from "./types";
import { dayFromIso, isoFromDay, weekdayOfDay, zoneClock, type DayNumber } from "./zone";

export type DateHours = {
  date: string;
  /** Effective wall-clock ranges (sorted, zero-length dropped). Empty when blocked or unavailable. */
  ranges: MinuteRange[];
  /** "holiday" when the date is in blockedDates (ranges are then empty; `holidayRanges` keeps what it would offer). */
  source: "holiday" | "override" | "weekly";
  holidayRanges: MinuteRange[];
};

export interface HostBlocks {
  /** Merged within each local date, sorted, never crossing the schedule's local midnight. */
  anchors: Interval[];
  /** Anchor blocks merged across midnight. */
  containment: Interval[];
  /** Anchor blocks that blocked dates (holidays) would have offered (troubleshoot HOLIDAY context). */
  holidayAnchors: Interval[];
  /** Containment including the holiday anchors (what the schedule would offer without holidays). */
  holidayContainment: Interval[];
}

const EMPTY: MinuteRange[] = [];

/** Valid ranges only: finite, clamped to 0..1440, end after start, sorted by start. */
export function sanitizeRanges(ranges: readonly MinuteRange[] | null | undefined): MinuteRange[] {
  if (!Array.isArray(ranges) || ranges.length === 0) return EMPTY;
  const out: MinuteRange[] = [];
  for (const r of ranges) {
    if (!r || typeof r !== "object") continue;
    const s = Math.min(1440, Math.max(0, Number(r.start)));
    const e = Math.min(1440, Math.max(0, Number(r.end)));
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    out.push({ start: s, end: e });
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

const blockedSets = new WeakMap<ScheduleInput, Set<string>>();

function blockedSet(schedule: ScheduleInput): Set<string> {
  let set = blockedSets.get(schedule);
  if (!set) {
    set = new Set(Array.isArray(schedule.blockedDates) ? schedule.blockedDates : []);
    blockedSets.set(schedule, set);
  }
  return set;
}

function hasOverride(schedule: ScheduleInput, date: string): boolean {
  const o = schedule.overrides;
  return !!o && Object.prototype.hasOwnProperty.call(o, date);
}

/** The effective hours of one local date ("YYYY-MM-DD") of the schedule. */
export function hoursForDate(schedule: ScheduleInput, date: string): DateHours {
  const day = dayFromIso(date);
  const base = hasOverride(schedule, date)
    ? { ranges: sanitizeRanges(schedule.overrides[date]), source: "override" as const }
    : { ranges: sanitizeRanges(schedule.weekly?.[weekdayOfDay(day)]), source: "weekly" as const };
  if (blockedSet(schedule).has(date)) return { date, ranges: EMPTY, source: "holiday", holidayRanges: base.ranges };
  return { date, ranges: base.ranges, source: base.source, holidayRanges: EMPTY };
}

function rangesToIntervals(zone: string, day: DayNumber, ranges: readonly MinuteRange[]): Interval[] {
  if (ranges.length === 0) return [];
  const clock = zoneClock(zone);
  const out: Interval[] = [];
  for (const r of ranges) {
    const start = clock.wallToUtc(day, r.start);
    const end = r.end >= 1440 ? clock.startOfDay(day + 1) : clock.wallToUtc(day, r.end);
    if (end > start) out.push({ start, end });
  }
  return mergeIntervals(out);
}

/** UTC anchor blocks of one local date (empty when blocked or unavailable). */
export function dateIntervals(schedule: ScheduleInput, date: string): Interval[] {
  return rangesToIntervals(schedule.timeZone, dayFromIso(date), hoursForDate(schedule, date).ranges);
}

/** Local dates of `zone` covering [from, to) plus `marginDays` on each side (inclusive list). */
export function localDaysCovering(zone: string, from: Millis, to: Millis, marginDays: number): DayNumber[] {
  const clock = zoneClock(zone);
  const first = clock.localDay(from) - marginDays;
  const last = clock.localDay(Math.max(from, to)) + marginDays;
  const out: DayNumber[] = [];
  for (let d = first; d <= last; d++) out.push(d);
  return out;
}

/**
 * Anchor and containment blocks of a schedule for the local dates covering [from, to) with `marginDays` extra dates
 * on each side (the engine uses one day plus the duration so containment around the range edges is complete).
 */
export function buildHostBlocks(schedule: ScheduleInput, from: Millis, to: Millis, marginDays = 1): HostBlocks {
  const zone = schedule.timeZone;
  zoneClock(zone); // validate the zone early
  const anchors: Interval[] = [];
  const holidayAnchors: Interval[] = [];
  for (const day of localDaysCovering(zone, from, to, marginDays)) {
    const hours = hoursForDate(schedule, isoFromDay(day));
    if (hours.source === "holiday") {
      for (const i of rangesToIntervals(zone, day, hours.holidayRanges)) holidayAnchors.push(i);
    } else {
      for (const i of rangesToIntervals(zone, day, hours.ranges)) anchors.push(i);
    }
  }
  anchors.sort((a, b) => a.start - b.start);
  holidayAnchors.sort((a, b) => a.start - b.start);
  return {
    anchors,
    containment: mergeIntervals(anchors),
    holidayAnchors,
    holidayContainment: holidayAnchors.length > 0 ? mergeIntervals([...anchors, ...holidayAnchors]) : mergeIntervals(anchors),
  };
}
