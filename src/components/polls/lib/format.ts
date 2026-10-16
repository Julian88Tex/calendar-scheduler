// Display helpers of the poll pages (SPEC MP-07, MP-16, MP-26). Pure and client safe.
import { formatDateShort, formatDuration, formatTime, formatWeekday } from "@/lib/time/format";
import { pt, ptCount } from "./t";

/** "30 min", "1 hr 30 min", "All day" (24 hours), or "Varies" when null. */
export function durationLabel(minutes: number | null, opts: { mixed?: "varies" | "mixed" } = {}): string {
  if (minutes === null) return pt(opts.mixed === "mixed" ? "common.mixedDurations" : "common.varies");
  if (minutes >= 24 * 60) return pt("common.allDay");
  return formatDuration(minutes);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["week", 7 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "in 3 hours", "2 days ago", "just now" (relative to `now`). */
export function relativeTime(iso: string | number | Date, now: number, locale = "en"): string {
  const t = new Date(iso).getTime();
  const diff = t - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return diff >= 0 ? "in a moment" : "just now";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (abs >= ms || unit === "minute") return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(Math.round(diff / 60_000), "minute");
}

/** "Tue, Oct 20, 5:00pm" in `zone`. */
export function shortWhen(iso: string, zone: string, hour12 = true, locale = "en"): string {
  return `${formatWeekday(iso, zone, locale)}, ${formatDateShort(iso, zone, locale)}, ${formatTime(iso, zone, locale, hour12)}`;
}

/** "Ana", "Ana and Ben", "Ana and 2 others". */
export function hostNamesLabel(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return pt("voter.hostsPair", { first: names[0]!, second: names[1]! });
  return pt("voter.hostsAnd", { first: names[0]!, count: names.length - 1 });
}

/** "3 Votes" / "1 Vote" [C]. */
export function votesLabel(count: number): string {
  return ptCount(count, "voter.vote", "voter.votes");
}

/** "1 time" / "3 times". */
export function timesLabel(count: number): string {
  return ptCount(count, "common.timeCount", "common.timesCount");
}

/** "{r} of {i} responded" when people were invited, else "{r} responses". */
export function responsesLabel(respondents: number, invited: number, scope: "list" | "results" = "list"): string {
  const ns = scope;
  if (invited > 0) return pt(`${ns}.respondedOf`, { r: respondents, i: Math.max(invited, respondents) });
  if (respondents === 0) return pt(`${ns}.noResponses`);
  return ptCount(respondents, `${ns}.response`, `${ns}.responses`);
}
