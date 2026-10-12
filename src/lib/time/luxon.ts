// Luxon setup and wall-clock helpers (ARCHITECTURE section 21, SPEC GEN-06, tech-reference 13).
//
// Importing this module sets Settings.defaultZone = "utc" so DateTime.fromISO("...Z") never lands in the process
// zone. Every helper takes the zone explicitly. Rules: iterate days in the schedule zone with plus({ days: 1 }) (never
// plus({ hours: 24 })); nonexistent local times (spring forward) shift forward; ambiguous local times (fall back) take
// the earlier instant. Client and server safe.
import { DateTime, Duration, Info, Interval, Settings } from "luxon";

Settings.defaultZone = "utc";

export { DateTime, Duration, Info, Interval, Settings };

export type DateInput = Date | number | string | DateTime;

/** A luxon DateTime for the instant, in `zone`. Strings are ISO 8601 (an instant, offset or Z). */
export function toDateTime(input: DateInput, zone = "utc"): DateTime {
  const dt =
    input instanceof DateTime
      ? input
      : input instanceof Date
        ? DateTime.fromJSDate(input)
        : typeof input === "number"
          ? DateTime.fromMillis(input)
          : DateTime.fromISO(input, { setZone: true });
  return dt.setZone(zone);
}

/** True when luxon can use the zone (any IANA zone or alias, plus "UTC"). */
export function isValidZone(zone: string): boolean {
  return Boolean(zone) && Info.isValidIANAZone(zone);
}

/** The local calendar date "YYYY-MM-DD" of an instant in `zone`. */
export function localDateOf(input: DateInput, zone: string): string {
  return toDateTime(input, zone).toISODate()!;
}

/** Minutes from local midnight of an instant in `zone` (0..1439). */
export function localMinutesOf(input: DateInput, zone: string): number {
  const dt = toDateTime(input, zone);
  return dt.hour * 60 + dt.minute;
}

/** Day of week of a local date or instant in `zone`, 0 = Sunday (WeeklyHours index). */
export function weekdayOf(input: DateInput | string, zone: string): number {
  const dt = typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? DateTime.fromISO(input, { zone })
    : toDateTime(input, zone);
  return dt.weekday % 7;
}

/** The UTC instant of local midnight of `date` in `zone`. `date` is "YYYY-MM-DD" or an instant (its local date). */
export function startOfLocalDay(date: DateInput | string, zone: string): Date {
  const day = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDateOf(date, zone);
  // Midnight may not exist (zones with DST at 00:00, for example America/Santiago): luxon shifts forward.
  return DateTime.fromISO(day, { zone }).startOf("day").toJSDate();
}

/**
 * The UTC instant of a wall-clock time `minutes` after local midnight on `date` ("YYYY-MM-DD") in `zone`.
 * minutes = 1440 is the next local midnight. Nonexistent times shift forward; ambiguous times take the earlier instant.
 */
export function wallClockToUtc(date: string, minutes: number, zone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`wallClockToUtc: invalid date ${date}`);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error("wallClockToUtc: minutes 0..1440");
  const base = DateTime.fromISO(date, { zone });
  const day = minutes === 1440 ? base.plus({ days: 1 }) : base;
  const m = minutes === 1440 ? 0 : minutes;
  return day.set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 }).toJSDate();
}

/** "YYYY-MM-DD" plus `days` calendar days (zone independent). */
export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: "utc" }).plus({ days }).toISODate()!;
}

/** Calendar days from `from` to `to` ("YYYY-MM-DD"), inclusive of `from`, exclusive of `to`. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** UTC offset of `zone` at an instant, in minutes (New York in winter: -300). */
export function zoneOffsetMinutes(zone: string, at: DateInput = Date.now()): number {
  return toDateTime(at, zone).offset;
}

/** "YYYY-MM" month of an instant in `zone`. */
export function localMonthOf(input: DateInput, zone: string): string {
  return toDateTime(input, zone).toFormat("yyyy-MM");
}

/** First day "YYYY-MM-01" and the first day of the next month for a "YYYY-MM" month. */
export function monthBounds(month: string): { start: string; end: string } {
  const start = DateTime.fromISO(`${month}-01`, { zone: "utc" });
  if (!start.isValid) throw new Error(`monthBounds: invalid month ${month}`);
  return { start: start.toISODate()!, end: start.plus({ months: 1 }).toISODate()! };
}
