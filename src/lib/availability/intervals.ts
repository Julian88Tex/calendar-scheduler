// Pure helpers of the availability editors (SPEC AV-03 to AV-07, ET-19). Client and server safe: no I/O, no clock.
//
// Hours are minutes from local midnight (0..1440, 1440 = midnight at the end of the day) in the schedule's zone.
// Validation follows AV-04: an end must be later than its start, and intervals of one day must not overlap (touching
// intervals such as 9:00 to 12:00 plus 12:00 to 17:00 are allowed and stay separate rows; the slot engine merges them).
import type { MinuteRange, WeeklyHours } from "@/db/types";
import { formatMinutes } from "@/components/ui/time-input-utils";

export const END_BEFORE_START_MESSAGE = "Choose an end time later than the start time.";
export const OVERLAP_MESSAGE = "Times overlap with another set of times.";

/** At most this many intervals per day (matches zDayIntervals). */
export const MAX_INTERVALS_PER_DAY = 48;
/** The interval a "+" on an unavailable day adds (Calendly: 9:00am to 5:00pm). */
export const DEFAULT_DAY_INTERVAL: MinuteRange = { start: 9 * 60, end: 17 * 60 };
/** Length of the interval a "+" adds after the last one (one hour). */
const ADDED_INTERVAL_MINUTES = 60;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

export type DateOverride = { date: string; intervals: MinuteRange[] };
/** The editable content of a schedule: zone, weekly hours and every date-specific override. */
export type ScheduleContent = { timezone: string; weeklyHours: WeeklyHours; overrides: DateOverride[] };
export type OverrideChange = { type: "upsert"; dates: string[]; intervals: MinuteRange[] } | { type: "delete"; date: string };

/** Weekday indexes (0 = Sunday) in display order for a week start (0 Sunday, 1 Monday). */
export function dayOrder(weekStart: 0 | 1 = 0): number[] {
  return Array.from({ length: 7 }, (_, i) => (i + weekStart) % 7);
}

const valid = (r: MinuteRange) => r.end > r.start;
const overlaps = (a: MinuteRange, b: MinuteRange) => a.start < b.end && b.start < a.end;

/**
 * Per interval error message (or null) for one day, in the given order: END_BEFORE_START_MESSAGE when the end is not
 * later than the start, OVERLAP_MESSAGE on the later interval of each overlapping pair.
 */
export function intervalErrors(list: readonly MinuteRange[]): (string | null)[] {
  return list.map((r, i) => {
    if (!valid(r)) return END_BEFORE_START_MESSAGE;
    for (let j = 0; j < i; j++) {
      const other = list[j]!;
      if (valid(other) && overlaps(r, other)) return OVERLAP_MESSAGE;
    }
    return null;
  });
}

export const INVALID_TIME_MESSAGE = "Enter a time.";
export const TOO_MANY_INTERVALS_MESSAGE = `Add up to ${MAX_INTERVALS_PER_DAY} sets of times per day.`;

/** Whole minutes within the day (0..1440). */
const inDay = (r: unknown): r is MinuteRange => {
  const x = r as MinuteRange | null;
  return Boolean(x) && typeof x === "object" && Number.isInteger(x!.start) && Number.isInteger(x!.end) && x!.start >= 0 && x!.end <= 1440;
};

/**
 * The first problem of one day's intervals (the AV-04 messages, a time outside the day, too many rows), or null when
 * the day is valid. Services use it so a direct call gets the same message as the form.
 */
export function dayProblem(list: readonly MinuteRange[]): string | null {
  if (!Array.isArray(list)) return INVALID_TIME_MESSAGE;
  if (list.length > MAX_INTERVALS_PER_DAY) return TOO_MANY_INTERVALS_MESSAGE;
  if (!list.every(inDay)) return INVALID_TIME_MESSAGE;
  return intervalErrors(list).find((e) => e !== null) ?? null;
}

export function dayIsValid(list: readonly MinuteRange[]): boolean {
  return dayProblem(list) === null;
}

/** The first problem of a weekly schedule (seven days, each valid), or null. */
export function weeklyProblem(weekly: WeeklyHours): string | null {
  if (!Array.isArray(weekly) || weekly.length !== 7) return INVALID_TIME_MESSAGE;
  for (const day of weekly) {
    const problem = dayProblem(day);
    if (problem) return problem;
  }
  return null;
}

export function weeklyIsValid(weekly: WeeklyHours): boolean {
  return weeklyProblem(weekly) === null;
}

/** A sorted copy (by start, then end). */
export function sortIntervals(list: readonly MinuteRange[]): MinuteRange[] {
  return list.map((r) => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Sorts each day of a weekly schedule (a deep copy). */
export function sortWeekly(weekly: WeeklyHours): WeeklyHours {
  return weekly.map((d) => sortIntervals(d)) as WeeklyHours;
}

/** The day re-sorted when it is valid (the editor keeps invalid days as typed so the error stays next to the row). */
export function settleDay(list: readonly MinuteRange[]): MinuteRange[] {
  return dayIsValid(list) ? sortIntervals(list) : list.map((r) => ({ ...r }));
}

export function sameIntervals(a: readonly MinuteRange[], b: readonly MinuteRange[]): boolean {
  return a.length === b.length && a.every((r, i) => r.start === b[i]!.start && r.end === b[i]!.end);
}

export function sameWeekly(a: WeeklyHours, b: WeeklyHours): boolean {
  return a.every((day, i) => sameIntervals(day, b[i] ?? []));
}

export function cloneWeekly(weekly: WeeklyHours): WeeklyHours {
  return weekly.map((d) => d.map((r) => ({ start: r.start, end: r.end }))) as WeeklyHours;
}

export function emptyWeekly(): WeeklyHours {
  return [[], [], [], [], [], [], []];
}

/**
 * The interval the "+" button adds: on an empty day 9:00am to 5:00pm; otherwise one hour long, starting one hour after
 * the latest end (capped at midnight); when that does not fit, the first free gap of at least 15 minutes. Null when the
 * day is full.
 */
export function nextInterval(list: readonly MinuteRange[]): MinuteRange | null {
  const items = list.filter(valid);
  if (items.length === 0) return { ...DEFAULT_DAY_INTERVAL };
  if (list.length >= MAX_INTERVALS_PER_DAY) return null;
  const lastEnd = Math.max(...items.map((r) => r.end));
  const start = Math.min(lastEnd + ADDED_INTERVAL_MINUTES, 1440 - 15);
  const candidate = { start, end: Math.min(start + ADDED_INTERVAL_MINUTES, 1440) };
  if (candidate.start >= lastEnd && candidate.end > candidate.start && !items.some((r) => overlaps(r, candidate))) return candidate;
  // No room after the last interval: the first gap of at least 15 minutes.
  const sorted = sortIntervals(items);
  let cursor = 0;
  for (const r of sorted) {
    if (r.start - cursor >= 15) return { start: cursor, end: Math.min(cursor + ADDED_INTERVAL_MINUTES, r.start) };
    cursor = Math.max(cursor, r.end);
  }
  if (1440 - cursor >= 15) return { start: cursor, end: Math.min(cursor + ADDED_INTERVAL_MINUTES, 1440) };
  return null;
}

/** Copies the intervals of `from` to every day of `to`, replacing their intervals (AV-05). */
export function copyDayTo(weekly: WeeklyHours, from: number, to: readonly number[]): WeeklyHours {
  const source = weekly[from] ?? [];
  const next = cloneWeekly(weekly);
  for (const d of to) {
    if (d === from || d < 0 || d > 6) continue;
    next[d] = source.map((r) => ({ start: r.start, end: r.end }));
  }
  return next;
}

/** "9:00am - 5:00pm" (24h: "09:00 - 17:00"); an end of 1440 reads "12:00am" / "24:00". */
export function formatInterval(r: MinuteRange, hour12 = true): string {
  return `${formatMinutes(r.start, hour12)} - ${formatMinutes(r.end, hour12)}`;
}

/** "9:00am - 12:00pm, 1:00pm - 5:00pm", or "Unavailable" when the day has no usable interval. */
export function formatDayIntervals(list: readonly MinuteRange[], hour12 = true): string {
  const items = sortIntervals(list.filter(valid));
  return items.length ? items.map((r) => formatInterval(r, hour12)).join(", ") : "Unavailable";
}

/** Compact hour for summaries: "9 am", "9:30 am", "17:00". */
function compactMinutes(m: number, hour12: boolean): string {
  if (!hour12) return formatMinutes(m, false);
  const v = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(v / 60);
  const mm = v % 60;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/**
 * One line summary of weekly hours (SPEC ET-19): "Weekdays, 9 am - 5 pm", "Every day, 9 am - 5 pm",
 * "Mon, Wed, 9 am - 12 pm" when every available day has the same hours, "Hours vary" otherwise, "No weekly hours" when
 * no day is available.
 */
export function weeklySummary(weekly: WeeklyHours, hour12 = true, weekStart: 0 | 1 = 0): string {
  const days = dayOrder(weekStart).filter((d) => (weekly[d] ?? []).some(valid));
  if (days.length === 0) return "No weekly hours";
  const first = sortIntervals((weekly[days[0]!] ?? []).filter(valid));
  if (!days.every((d) => sameIntervals(sortIntervals((weekly[d] ?? []).filter(valid)), first))) return "Hours vary";
  const set = new Set(days);
  let label: string;
  if (set.size === 7) label = "Every day";
  else if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) label = "Weekdays";
  else if (set.size === 2 && set.has(0) && set.has(6)) label = "Weekends";
  else label = days.map((d) => WEEKDAY_SHORT[d]).join(", ");
  const hours = first.map((r) => `${compactMinutes(r.start, hour12)} - ${compactMinutes(r.end, hour12)}`).join(", ");
  return `${label}, ${hours}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Date-specific hours (AV-06)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Weekday (0 = Sunday) of a "YYYY-MM-DD" date. */
export function weekdayOfDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** "Thu, Oct 22, 2026" (the date-specific hours list label). */
export function formatOverrideDate(date: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** "Thursday, October 22, 2026". */
export function formatLongDate(date: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export function sortOverrides(list: readonly DateOverride[]): DateOverride[] {
  return [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Upcoming overrides (today and later, ascending) and past ones (most recent first). */
export function partitionOverrides(list: readonly DateOverride[], today: string): { upcoming: DateOverride[]; past: DateOverride[] } {
  const sorted = sortOverrides(list);
  return { upcoming: sorted.filter((o) => o.date >= today), past: sorted.filter((o) => o.date < today).reverse() };
}

/** Applies an editor change to the override list (upsert replaces the dates' hours entirely). */
export function applyOverrideChange(list: readonly DateOverride[], change: OverrideChange): DateOverride[] {
  if (change.type === "delete") return list.filter((o) => o.date !== change.date);
  const dates = new Set(change.dates);
  const kept = list.filter((o) => !dates.has(o.date));
  const intervals = sortIntervals(change.intervals);
  return sortOverrides([...kept, ...[...dates].map((date) => ({ date, intervals: intervals.map((r) => ({ ...r })) }))]);
}

/**
 * The hours a date offers (AV-06: an override replaces the weekday hours entirely), with where they come from.
 */
export function effectiveHours(
  weekly: WeeklyHours,
  overrides: ReadonlyMap<string, readonly MinuteRange[]> | Readonly<Record<string, readonly MinuteRange[]>>,
  date: string,
): { intervals: MinuteRange[]; source: "override" | "weekly" } {
  const found = overrides instanceof Map ? overrides.get(date) : (overrides as Readonly<Record<string, readonly MinuteRange[]>>)[date];
  if (found) return { intervals: sortIntervals(found.filter(valid)), source: "override" };
  return { intervals: sortIntervals((weekly[weekdayOfDate(date)] ?? []).filter(valid)), source: "weekly" };
}
