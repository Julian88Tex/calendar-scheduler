// Booking window (SPEC SCH-02 to SCH-06; ARCHITECTURE section 7.3 step 1). All local dates and times are in
// rules.rangeZone.
//
// - Minimum notice: candidates before `now` are PAST, before `now + notice` are TOOSOON (elapsed time).
// - Rolling calendar days (observed Calendly behavior): the last allowed start is the same local time N days later
//   (7 days at 08:00 on Apr 16 allows 08:00 on Apr 23, not 08:15), DST safe.
// - Rolling weekdays: count N Monday to Friday dates after today (weekend dates are skipped while counting); the
//   last allowed start is the current local time on the Nth counted date. Weekend dates inside stay bookable.
// - Rolling days with availability: count local dates whose combined availability (pooling rules applied, holidays
//   and date-specific hours included, busy times ignored) is non-empty; a date counts only when one of its combined
//   intervals ends after now + notice (for today this is the SCH-03 rule; later dates entirely before the notice
//   cutoff cannot be booked either, so they do not count). The window ends at the end of the Nth counted date. The
//   walk needs every future override and blocked date (the caller loads them), so the end never depends on the
//   requested range. The walk stops after 3,650 dates.
// - Fixed range: inclusive local start and end dates. Unlimited: no end.
import { combineBlocks } from "./blocks";
import { mergeIntervals } from "./busy";
import { groupHosts } from "./pooling";
import { buildHostBlocks, sanitizeRanges, type HostBlocks } from "./schedule";
import type { EventTypeRules, HostInput, Interval, Millis, ReasonCode } from "./types";
import { DAY_MS, MINUTE_MS, dayFromIso, isIsoDate, isoFromDay, weekdayOfDay, zoneClock, type ZoneClock } from "./zone";

export const MAX_WINDOW_DAYS = 3650;
const AVAILABLE_DAYS_CHUNK = 42;

export interface BookingWindow {
  now: Millis;
  /** now + minimum notice. */
  earliest: Millis;
  /** Inclusive lower bound from a fixed date range (null when none). */
  start: Millis | null;
  /** Exclusive upper bound (null = unlimited). Rolling modes: last allowed start + 1 ms. */
  end: Millis | null;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.min(max, Math.max(min, v));
}

/** Minimum notice in ms (0 to 365 days). */
export function noticeMs(rules: Pick<EventTypeRules, "minimumNoticeMinutes">): number {
  return clampInt(rules.minimumNoticeMinutes, 0, 365 * 1440, 0) * MINUTE_MS;
}

function isSpotsMode(rules: EventTypeRules): boolean {
  return Array.isArray(rules.spots);
}

function rollingWeekdaysLastStart(clock: ZoneClock, now: Millis, days: number): Millis {
  const naive = clock.toNaive(now);
  const today = Math.floor(naive / DAY_MS);
  const timeOfDay = naive - today * DAY_MS;
  let d = today;
  let counted = 0;
  while (counted < days) {
    d++;
    const wd = weekdayOfDay(d);
    if (wd >= 1 && wd <= 5) counted++;
  }
  return clock.fromNaive(d * DAY_MS + timeOfDay);
}

/** Combined containment blocks over [from, to) for the available_days walk. */
function combinedContainment(rules: EventTypeRules, hosts: readonly HostInput[], from: Millis, to: Millis): Interval[] {
  if (isSpotsMode(rules)) return mergeIntervals((rules.spots ?? []).filter((s) => s.end > from && s.start < to));
  const groups = groupHosts(rules, hosts);
  const blocks = new Map<string, HostBlocks>();
  for (const h of groups.hosts) {
    if (h.schedule) blocks.set(h.userId, buildHostBlocks(h.schedule, from, to, 1));
  }
  return combineBlocks(groups, (id) => blocks.get(id), rules.rangeZone).containment;
}

/**
 * False when no future date can ever count (a required host or a whole pool has no weekly hours and no future
 * date-specific hours), so the walk can stop at once instead of scanning 3,650 empty dates.
 */
function canEverBeAvailable(rules: EventTypeRules, hosts: readonly HostInput[], fromDate: string, now: Millis): boolean {
  if (isSpotsMode(rules)) return (rules.spots ?? []).some((s) => s.end > now && s.end > s.start);
  const possible = (h: HostInput): boolean => {
    const s = h.schedule;
    if (!s) return false;
    if ((s.weekly ?? []).some((day) => sanitizeRanges(day).length > 0)) return true;
    for (const [date, ranges] of Object.entries(s.overrides ?? {})) {
      if (date >= fromDate && sanitizeRanges(ranges).length > 0) return true;
    }
    return false;
  };
  const groups = groupHosts(rules, hosts);
  if (groups.required.length + groups.pools.length === 0) return false;
  return groups.required.every(possible) && groups.pools.every((p) => p.members.some(possible));
}

function availableDaysEnd(
  rules: EventTypeRules,
  hosts: readonly HostInput[],
  clock: ZoneClock,
  now: Millis,
  earliest: Millis,
  days: number,
): Millis {
  const today = clock.localDay(now);
  const capDay = today + MAX_WINDOW_DAYS;
  if (days <= 0) return clock.startOfDay(today);
  if (!canEverBeAvailable(rules, hosts, isoFromDay(today - 1), now)) return clock.startOfDay(capDay);
  let counted = 0;
  for (let d0 = today; d0 < capDay; d0 += AVAILABLE_DAYS_CHUNK) {
    const d1 = Math.min(d0 + AVAILABLE_DAYS_CHUNK, capDay);
    const blocks = combinedContainment(rules, hosts, clock.startOfDay(d0), clock.startOfDay(d1));
    let k = 0;
    for (let d = d0; d < d1; d++) {
      const ds = clock.startOfDay(d);
      const de = clock.startOfDay(d + 1);
      while (k < blocks.length && blocks[k]!.end <= ds) k++;
      let counts = false;
      for (let j = k; j < blocks.length && blocks[j]!.start < de; j++) {
        const s = Math.max(blocks[j]!.start, ds);
        const e = Math.min(blocks[j]!.end, de);
        if (e > s && e > earliest) {
          counts = true;
          break;
        }
      }
      if (counts && ++counted >= days) return de;
    }
  }
  return clock.startOfDay(capDay);
}

/** The booking window for `now` (pure; available_days walks the hosts' schedules). */
export function bookingWindow(input: { rules: EventTypeRules; hosts: readonly HostInput[]; now: Millis }): BookingWindow {
  const { rules, hosts, now } = input;
  const earliest = now + noticeMs(rules);
  const clock = zoneClock(rules.rangeZone);
  const range = rules.dateRange;
  if (!range || range.type === "unlimited") return { now, earliest, start: null, end: null };
  if (range.type === "fixed") {
    if (!isIsoDate(range.startDate) || !isIsoDate(range.endDate)) return { now, earliest, start: now, end: now };
    const startDay = dayFromIso(range.startDate);
    const endDay = dayFromIso(range.endDate);
    const start = clock.startOfDay(startDay);
    if (endDay < startDay) return { now, earliest, start, end: start };
    return { now, earliest, start, end: clock.startOfDay(endDay + 1) };
  }
  const days = clampInt(range.days, 0, MAX_WINDOW_DAYS, 0);
  if (range.mode === "available_days") {
    return { now, earliest, start: null, end: availableDaysEnd(rules, hosts, clock, now, earliest, days) };
  }
  const lastStart = range.mode === "weekdays" ? rollingWeekdaysLastStart(clock, now, days) : clock.plusLocalDays(now, days);
  return { now, earliest, start: null, end: lastStart + 1 };
}

/** PAST, TOOSOON and RANGE codes of a candidate start. */
export function windowReasons(start: Millis, w: BookingWindow): ReasonCode[] {
  const out: ReasonCode[] = [];
  if (start < w.now) out.push("PAST");
  else if (start < w.earliest) out.push("TOOSOON");
  if ((w.start !== null && start < w.start) || (w.end !== null && start >= w.end)) out.push("RANGE");
  return out;
}

/** True when a start passes notice and range. */
export function inWindow(start: Millis, w: BookingWindow): boolean {
  return start >= w.earliest && start >= w.now && (w.start === null || start >= w.start) && (w.end === null || start < w.end);
}
