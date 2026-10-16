// Option display helpers (SPEC MP-07, MP-16, MP-29; research meeting-polls.md B5.1, B20). Pure and client safe: the
// voter page groups options by the voter's local date, the results page and the emails label them in the host zone.
//
// Timed options are UTC instants shown in the viewer's zone (an option may land on another date than the host sees;
// one crossing local midnight shows under its start date with "(ends next day)"). Date-only options store a date and
// display the same calendar day for everyone; for ordering, the past check and holds they start at local midnight in
// the poll zone. Intl only (through grid.ts and src/lib/time/format.ts): the public voter page bundles this file, so
// it must never pull in Luxon.
import { formatDateLong, formatTime, formatWeekday } from "@/lib/time/format";
import { dayEnd, dayStart, localDate } from "./grid";
import type { PollOptionView } from "./types";

type OptionLike = Pick<PollOptionView, "start" | "end" | "allDayDate" | "durationMinutes">;

/** Epoch ms when the option starts (date-only: local midnight in the poll zone). */
export function optionStartMs(o: OptionLike, pollZone: string): number {
  if (o.allDayDate) return dayStart(o.allDayDate, pollZone);
  return new Date(o.start!).getTime();
}

/** Epoch ms when the option ends (date-only: the next local midnight in the poll zone). */
export function optionEndMs(o: OptionLike, pollZone: string): number {
  if (o.allDayDate) return dayEnd(o.allDayDate, pollZone);
  return new Date(o.end!).getTime();
}

/** The single duration of a poll's options, or null when they differ ("Varies", "Mixed durations"). */
export function commonDuration(options: readonly Pick<PollOptionView, "durationMinutes" | "allDayDate">[]): number | null {
  const set = new Set(options.map((o) => (o.allDayDate ? -1 : o.durationMinutes)));
  if (set.size !== 1) return null;
  const v = [...set][0]!;
  return v === -1 ? 24 * 60 : v;
}

/** Local date key an option is listed under in `zone` (date-only options keep their date). */
export function optionLocalDate(o: OptionLike, zone: string): string {
  if (o.allDayDate) return o.allDayDate;
  return localDate(new Date(o.start!).getTime(), zone);
}

export type OptionDateGroup<T> = { date: string; label: string; options: T[] };

/** Options grouped by local date ("Tuesday, October 20, 2026"), in start order. */
export function groupOptionsByLocalDate<T extends OptionLike>(options: readonly T[], zone: string, pollZone: string, locale = "en"): OptionDateGroup<T>[] {
  const sorted = [...options].sort((a, b) => optionStartMs(a, pollZone) - optionStartMs(b, pollZone));
  const groups = new Map<string, T[]>();
  for (const o of sorted) {
    const key = optionLocalDate(o, zone);
    const list = groups.get(key) ?? [];
    list.push(o);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, list]) => ({ date, label: formatDateLong(`${date}T12:00:00Z`, "UTC", locale), options: list }));
}

/** "10:00am - 10:30am", "11:00pm - 12:30am (ends next day)" or "All day". */
export function optionTimeLabel(o: OptionLike, zone: string, opts: { locale?: string; hour12?: boolean } = {}): string {
  if (o.allDayDate) return "All day";
  const locale = opts.locale ?? "en";
  const hour12 = opts.hour12 ?? true;
  const s = new Date(o.start!);
  const e = new Date(o.end!);
  const range = `${formatTime(s, zone, locale, hour12)} - ${formatTime(e, zone, locale, hour12)}`;
  const startDay = localDate(s.getTime(), zone);
  const endDay = localDate(e.getTime() - 1, zone);
  return startDay === endDay ? range : `${range} (ends next day)`;
}

/** "Tuesday, October 20, 2026, 10:00am - 10:30am" (emails, CSV headers, the book dialog). */
export function optionLongLabel(o: OptionLike, zone: string, opts: { locale?: string; hour12?: boolean } = {}): string {
  const locale = opts.locale ?? "en";
  const date = o.allDayDate ? formatDateLong(`${o.allDayDate}T12:00:00Z`, "UTC", locale) : formatDateLong(new Date(o.start!), zone, locale);
  return `${date}, ${optionTimeLabel(o, zone, opts)}`;
}

/** "Tue, Oct 20, 10:00am" (list "Top time" preview). */
export function optionShortLabel(o: OptionLike, zone: string, opts: { locale?: string; hour12?: boolean } = {}): string {
  const locale = opts.locale ?? "en";
  const day = (at: Date, z: string) =>
    `${formatWeekday(at, z, locale)}, ${new Intl.DateTimeFormat(locale, { timeZone: z, month: "short", day: "numeric" }).format(at)}`;
  if (o.allDayDate) return `${day(new Date(`${o.allDayDate}T12:00:00Z`), "UTC")}, All day`;
  const s = new Date(o.start!);
  return `${day(s, zone)}, ${formatTime(s, zone, locale, opts.hour12 ?? true)}`;
}

/** "Oct 20 to Oct 24" (list date range). */
export function optionRangeLabel(first: OptionLike | null, last: OptionLike | null, zone: string, locale = "en"): string | null {
  if (!first || !last) return null;
  const short = (o: OptionLike) => {
    const at = o.allDayDate ? `${o.allDayDate}T12:00:00Z` : o.start!;
    const z = o.allDayDate ? "UTC" : zone;
    return new Intl.DateTimeFormat(locale, { timeZone: z, month: "short", day: "numeric" }).format(new Date(at));
  };
  const a = short(first);
  const b = short(last);
  return a === b ? a : `${a} to ${b}`;
}

/**
 * "Copy times as text" (MP-05): the options grouped by date in `zone` (the host's), one time range per line, the zone
 * and the poll link, ready to paste into an email or a chat.
 */
export function timesAsText<T extends OptionLike>(
  options: readonly T[],
  p: { zone: string; pollZone: string; zoneLabel: string; link: string; locale?: string; hour12?: boolean },
): string {
  const locale = p.locale ?? "en";
  const blocks = groupOptionsByLocalDate(options, p.zone, p.pollZone, locale).map((g) =>
    [g.label, ...g.options.map((o) => optionTimeLabel(o, p.zone, { locale, hour12: p.hour12 }))].join("\n"),
  );
  return [...blocks, `Times are shown in ${p.zoneLabel}.\nVote on times: ${p.link}`].join("\n\n");
}
