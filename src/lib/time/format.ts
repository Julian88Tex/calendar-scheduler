// Locale-aware date and time formatting (SPEC GEN-06, GEN-10; ARCHITECTURE section 19). Client and server safe.
//
// Patterns: times "9:00am" (12h, lowercase, no space) or "09:00" (24h); dates "%A, %B %-d, %Y" ("Wednesday, October 14,
// 2026"), "%A, %B %-d" ("Wednesday, October 14"), "%b %-d" ("Oct 14"); ranges "10:00am - 10:30am". Every function takes
// the zone explicitly: invitee messages use the invitee's stored zone and format, host messages the host profile, the
// dashboard the user's settings.
import { dtf, formatClock, localePrefers24h, toDate, type DateLike } from "./clock";
import { currentLocalTime, friendlyZoneName } from "./zones";

export type { DateLike };
export { localePrefers24h };

export type TimeFormat = "12h" | "24h";

/** hour12 flag from a stored time_format ("12h" | "24h"), or from the locale when unknown. */
export function hour12For(timeFormat: string | null | undefined, locale = "en"): boolean {
  if (timeFormat === "24h") return false;
  if (timeFormat === "12h") return true;
  return !localePrefers24h(locale);
}

/** "9:00am" / "09:00". */
export function formatTime(date: DateLike, zone: string, locale = "en", hour12 = true): string {
  return formatClock(date, zone, locale, hour12);
}

/** "10:00am - 10:30am". */
export function formatTimeRange(start: DateLike, end: DateLike, zone: string, locale = "en", hour12 = true): string {
  return `${formatClock(start, zone, locale, hour12)} - ${formatClock(end, zone, locale, hour12)}`;
}

/** "Wednesday, October 14, 2026" (%A, %B %-d, %Y). */
export function formatDateLong(date: DateLike, zone: string, locale = "en"): string {
  return dtf(locale, { timeZone: zone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(
    toDate(date),
  );
}

/** "Wednesday, October 14" (%A, %B %-d). */
export function formatDateMedium(date: DateLike, zone: string, locale = "en"): string {
  return dtf(locale, { timeZone: zone, weekday: "long", month: "long", day: "numeric" }).format(toDate(date));
}

/** "Oct 14" (%b %-d). */
export function formatDateShort(date: DateLike, zone: string, locale = "en"): string {
  return dtf(locale, { timeZone: zone, month: "short", day: "numeric" }).format(toDate(date));
}

/** "October 2026". */
export function formatMonthYear(date: DateLike, zone: string, locale = "en"): string {
  return dtf(locale, { timeZone: zone, month: "long", year: "numeric" }).format(toDate(date));
}

/** "Wed" / "Wednesday". */
export function formatWeekday(date: DateLike, zone: string, locale = "en", style: "short" | "long" = "short"): string {
  return dtf(locale, { timeZone: zone, weekday: style }).format(toDate(date));
}

/** Booking confirmation line: "10:00am - 10:30am, Wednesday, October 14, 2026". */
export function formatMeetingWhen(start: DateLike, end: DateLike, zone: string, locale = "en", hour12 = true): string {
  return `${formatTimeRange(start, end, zone, locale, hour12)}, ${formatDateLong(start, zone, locale)}`;
}

/** Dashboard numeric date per users.date_format ("MM/DD/YYYY" or "DD/MM/YYYY"). */
export function formatNumericDate(date: DateLike, zone: string, dateFormat: string | null | undefined = "MM/DD/YYYY"): string {
  const parts = dtf("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    toDate(date),
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return dateFormat === "DD/MM/YYYY" ? `${get("day")}/${get("month")}/${get("year")}` : `${get("month")}/${get("day")}/${get("year")}`;
}

/**
 * Friendly zone label (ARCHITECTURE 19): the `zones` i18n namespace object can be passed as `names` (the catalog is
 * owned by i18n); without it English uses the curated names and other locales Intl's generic names.
 */
export function formatZoneLabel(zone: string, locale = "en", names?: Readonly<Record<string, string>>): string {
  return friendlyZoneName(zone, locale, names);
}

/** "Eastern Time - US & Canada (6:53pm)" (booking page zone button). */
export function formatZoneWithTime(
  zone: string,
  opts: { locale?: string; hour12?: boolean; at?: DateLike; names?: Readonly<Record<string, string>> } = {},
): string {
  const locale = opts.locale ?? "en";
  return `${friendlyZoneName(zone, locale, opts.names)} (${currentLocalTime(zone, { locale, hour12: opts.hour12 ?? true, at: opts.at })})`;
}

/** "30 min", "1 hr", "1 hr 30 min", "2 hr", "2 hr 30 min" (event type durations, Calendly style: "hr" is never plural). */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  const hours = `${h} hr`;
  return rest ? `${hours} ${rest} min` : hours;
}

/** "GMT-04:00" style offset label of a zone at an instant. */
export function formatOffset(zone: string, at: DateLike = Date.now()): string {
  const part = dtf("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(toDate(at))
    .find((p) => p.type === "timeZoneName")?.value;
  return part === "GMT" ? "GMT+00:00" : (part ?? "GMT+00:00");
}

/** ISO date "YYYY-MM-DD" of an instant in a zone (Intl based; luxon users can use localDateOf). */
export function isoDateInZone(date: DateLike, zone: string): string {
  const parts = dtf("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    toDate(date),
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
