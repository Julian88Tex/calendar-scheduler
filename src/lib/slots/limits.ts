// Meeting limits (SPEC SCH-08 event type limits, SCH-09 host limits, SCH-24 reschedule exclusion; ARCHITECTURE 7.3
// steps 5c and 5d).
//
// Periods are local days, weeks (starting Sunday = 0 or Monday = 1) and calendar months in a zone. A candidate is
// blocked when the number of counted meeting starts in its period is at least the limit. Counted starts skip the
// meeting being rescheduled (ignoreMeetingIds) and count each meeting id once (a group slot is one meeting). Counts
// always cover whole periods: callers load starts from startOfWeek(startOfMonth(rangeStart)) to
// endOfWeek(endOfMonth(rangeEnd)), which `limitCountSpan` computes.
import type { Interval, MeetingStart, Millis, PeriodLimits, ReasonCode } from "./types";
import {
  startOfMonthDay,
  startOfNextMonthDay,
  startOfWeekDay,
  yearMonthOfDay,
  zoneClock,
  type DayNumber,
  type ZoneClock,
} from "./zone";

export type Period = "day" | "week" | "month";
export type PeriodKeys = { day: number; week: number; month: number };

/** Numeric period keys of an instant: local day number, day number of the week start, and year * 12 + month. */
export function periodKeysOf(ms: Millis, clock: ZoneClock, weekStart: 0 | 1): PeriodKeys {
  const day = clock.localDay(ms);
  return periodKeysOfDay(day, weekStart);
}

export function periodKeysOfDay(day: DayNumber, weekStart: 0 | 1): PeriodKeys {
  const { year, month } = yearMonthOfDay(day);
  return { day, week: startOfWeekDay(day, weekStart), month: year * 12 + (month - 1) };
}

export type PeriodCounts = { day: Map<number, number>; week: Map<number, number>; month: Map<number, number> };

/** Counts meeting starts per period, skipping ignored meeting ids and counting each meeting id once. */
export function countByPeriod(
  starts: readonly MeetingStart[] | null | undefined,
  zone: string,
  weekStart: 0 | 1,
  ignoreMeetingIds: ReadonlySet<string>,
): PeriodCounts {
  const counts: PeriodCounts = { day: new Map(), week: new Map(), month: new Map() };
  if (!starts || starts.length === 0) return counts;
  const clock = zoneClock(zone);
  const seen = new Set<string>();
  for (const m of starts) {
    if (!m || !Number.isFinite(m.start)) continue;
    if (m.meetingId) {
      if (ignoreMeetingIds.has(m.meetingId) || seen.has(m.meetingId)) continue;
      seen.add(m.meetingId);
    }
    const k = periodKeysOf(m.start, clock, weekStart);
    counts.day.set(k.day, (counts.day.get(k.day) ?? 0) + 1);
    counts.week.set(k.week, (counts.week.get(k.week) ?? 0) + 1);
    counts.month.set(k.month, (counts.month.get(k.month) ?? 0) + 1);
  }
  return counts;
}

const activeLimit = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** True when any period limit is set. */
export function hasLimits(limits: PeriodLimits | null | undefined): boolean {
  return !!limits && (activeLimit(limits.day) || activeLimit(limits.week) || activeLimit(limits.month));
}

/** The periods whose count reached the limit. */
export function reachedPeriods(keys: PeriodKeys, counts: PeriodCounts, limits: PeriodLimits | null | undefined): Period[] {
  const out: Period[] = [];
  if (!limits) return out;
  if (activeLimit(limits.day) && (counts.day.get(keys.day) ?? 0) >= limits.day) out.push("day");
  if (activeLimit(limits.week) && (counts.week.get(keys.week) ?? 0) >= limits.week) out.push("week");
  if (activeLimit(limits.month) && (counts.month.get(keys.month) ?? 0) >= limits.month) out.push("month");
  return out;
}

const EVENT_TYPE_CODES: Record<Period, ReasonCode> = { day: "DAILY_MAX", week: "WEEKLY_MAX", month: "MONTHLY_MAX" };

/** Event type limit codes (DAILY_MAX, WEEKLY_MAX, MONTHLY_MAX) for the periods reached. */
export function eventTypeLimitCodes(periods: readonly Period[]): ReasonCode[] {
  return periods.map((p) => EVENT_TYPE_CODES[p]);
}

/**
 * The span of meeting starts a caller must load so counts cover whole periods around [rangeStart, rangeEnd):
 * from the start of the week containing the first day of rangeStart's month to the end of the week containing the
 * last day of rangeEnd's month, in `zone` with `weekStart`.
 */
export function limitCountSpan(rangeStart: Millis, rangeEnd: Millis, zone: string, weekStart: 0 | 1): Interval {
  const clock = zoneClock(zone);
  const firstDay = startOfWeekDay(startOfMonthDay(clock.localDay(rangeStart)), weekStart);
  const lastInstant = Math.max(rangeStart, rangeEnd - 1);
  const monthEnd = startOfNextMonthDay(clock.localDay(lastInstant)); // first day after the month
  const endDay = startOfWeekDay(monthEnd - 1, weekStart) + 7; // first day after the week of the month's last day
  return { start: clock.startOfDay(firstDay), end: clock.startOfDay(endDay) };
}
