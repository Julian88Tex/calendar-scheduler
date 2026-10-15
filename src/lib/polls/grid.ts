// Creation grid time math (SPEC MP-02, MP-29; research meeting-polls.md B3.1, B20). Pure and client safe: the week
// grid of polls-ui builds its rows and cells from these helpers so every option is a correct UTC instant.
//
// - Rows are wall-clock times of the poll zone (every `step` minutes). A wall time that does not exist on a date (the
//   spring forward gap, for example 2026-03-08 02:00 to 03:00 in America/New_York) is a "nonexistent" cell (rendered
//   hatched "Doesn't exist (DST)"); a wall time that happens twice (the fall back hour, 2026-11-01 01:00 to 02:00) gets
//   a second row with the later offset, labelled "1:00am (EDT)" / "1:00am (EST)".
// - Durations are absolute minutes: a 60 minute option at 01:30 EDT on fall back day ends at 01:30 EST.
// - "Copy this day's times to..." copies wall-clock times (09:00 stays 09:00 across a DST change).
// - "Add all free times" fills a day with back-to-back options inside working hours, skipping busy times.
//
// Intl only (no Luxon): the public voter page imports display.ts, which builds on these helpers, so they must stay
// lean. A wall clock time is turned into instants with the zone's UTC offsets around it (the standard "offset before
// and after" method); a day without an offset change (nearly every day) takes a cached fast path. Nonexistent wall
// times shift forward by the gap (02:30 on a spring forward day becomes 03:30 of the new offset) and repeated ones
// take the earlier offset, the way Luxon resolved them before.
import { dtf } from "@/lib/time/clock";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** The wall clock of an instant in `zone` (Intl, 24 hour cycle). */
function wallOf(instant: number, zone: string): Wall {
  const parts = dtf("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** UTC offset of `zone` at an instant, in milliseconds (wall clock minus UTC). */
function offsetAt(instant: number, zone: string): number {
  const w = wallOf(instant, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "YYYY-MM-DD" parts, or null when the date does not exist (2026-02-30). */
function parseDate(date: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d ? [y, mo, d] : null;
}

function isoDate(y: number, mo: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The date `days` after `date` (calendar arithmetic, no zone). */
function addDays(date: string, days: number): string {
  const p = parseDate(date);
  if (!p) return date;
  const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

const uniformCache = new Map<string, number | null>();

/**
 * The single UTC offset of `zone` around a local date (a day before to a day after), or null when the offset changes
 * in that window (DST days and their neighbours take the exact path).
 */
function uniformOffset(localMidnight: number, zone: string): number | null {
  const key = `${zone}|${localMidnight}`;
  const hit = uniformCache.get(key);
  if (hit !== undefined) return hit;
  const before = offsetAt(localMidnight - DAY, zone);
  const after = offsetAt(localMidnight + 2 * DAY, zone);
  const value = before === after && offsetAt(localMidnight + DAY / 2, zone) === before ? before : null;
  if (uniformCache.size > 2000) uniformCache.clear();
  uniformCache.set(key, value);
  return value;
}

/** Every instant whose wall clock in `zone` reads `local` (wall clock as if UTC, ms): 0, 1 or 2, ascending. */
function instantsForLocal(local: number, zone: string, localMidnight: number): number[] {
  const uniform = uniformOffset(localMidnight, zone);
  if (uniform !== null) return [local - uniform];
  const out: number[] = [];
  for (const o of new Set([offsetAt(local - DAY, zone), offsetAt(local + DAY, zone)])) {
    const t = local - o;
    if (offsetAt(t, zone) === o) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The instant of a wall clock time on a date in `zone`: a repeated time takes the earlier offset, a nonexistent one
 * shifts forward by the gap (the offset in force before the change). NaN for a date that does not exist.
 */
function wallClockInstant(date: string, minutes: number, zone: string): number {
  const p = parseDate(date);
  if (!p) return Number.NaN;
  const midnight = Date.UTC(p[0], p[1] - 1, p[2]);
  const local = midnight + minutes * MIN;
  const found = instantsForLocal(local, zone, midnight);
  if (found.length) return found[0]!;
  return local - offsetAt(local - DAY, zone);
}

export type GridCell =
  | { state: "ok"; start: number; offsetLabel: string | null; past: boolean }
  | { state: "nonexistent" }
  /** This variant row does not apply to the date (only fall back days have the second row). */
  | { state: "absent" };

export type GridRow = {
  /** Wall-clock minutes after local midnight. */
  minutes: number;
  /** 0 = the first (or only) occurrence of the wall time, 1 = the repeated fall back occurrence. */
  variant: 0 | 1;
  cells: Record<string, GridCell>;
};

/** Every instant (epoch ms) whose wall clock in `zone` is `minutes` after midnight on `date` (0, 1 or 2 instants). */
export function instantsForWallTime(date: string, minutes: number, zone: string): number[] {
  const p = parseDate(date);
  if (!p || minutes < 0 || minutes >= 1440) return [];
  const midnight = Date.UTC(p[0], p[1] - 1, p[2]);
  return instantsForLocal(midnight + minutes * MIN, zone, midnight);
}

/** Short zone abbreviation at an instant ("EDT", "EST"; "GMT+2" style when the zone has none). */
export function offsetLabelAt(instant: number, zone: string, locale = "en-US"): string {
  const parts = dtf(locale, { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(instant));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "UTC";
}

/**
 * Week (or any date list) rows for the grid: wall-clock rows every `step` minutes, plus repeated rows for fall back
 * hours. Cells before `now` are flagged past (not clickable).
 */
export function gridRows(dates: readonly string[], zone: string, opts: { step?: number; now?: number } = {}): GridRow[] {
  const step = opts.step ?? 15;
  if (step <= 0 || 1440 % step !== 0) throw new Error("gridRows: step must divide a day");
  const now = opts.now ?? Date.now();
  const rows: GridRow[] = [];
  for (let m = 0; m < 1440; m += step) {
    const first: Record<string, GridCell> = {};
    const second: Record<string, GridCell> = {};
    let repeated = false;
    for (const date of dates) {
      const instants = instantsForWallTime(date, m, zone);
      if (instants.length === 0) {
        first[date] = { state: "nonexistent" };
        second[date] = { state: "absent" };
        continue;
      }
      const ambiguous = instants.length > 1;
      first[date] = { state: "ok", start: instants[0]!, offsetLabel: ambiguous ? offsetLabelAt(instants[0]!, zone) : null, past: instants[0]! <= now };
      if (ambiguous) {
        repeated = true;
        second[date] = { state: "ok", start: instants[1]!, offsetLabel: offsetLabelAt(instants[1]!, zone), past: instants[1]! <= now };
      } else {
        second[date] = { state: "absent" };
      }
    }
    rows.push({ minutes: m, variant: 0, cells: first });
    if (repeated) rows.push({ minutes: m, variant: 1, cells: second });
  }
  return rows;
}

/** The option a click on a cell creates: the cell instant plus `durationMinutes` absolute minutes. */
export function optionFromCell(start: number, durationMinutes: number): { start: string; end: string } {
  return { start: new Date(start).toISOString(), end: new Date(start + durationMinutes * MIN).toISOString() };
}

/** Local date "YYYY-MM-DD" of an instant in `zone`. */
export function localDate(instant: number, zone: string): string {
  const w = wallOf(instant, zone);
  return isoDate(w.year, w.month, w.day);
}

/** Wall-clock minutes after local midnight of an instant in `zone`. */
export function localMinutes(instant: number, zone: string): number {
  const w = wallOf(instant, zone);
  return w.hour * 60 + w.minute;
}

/** Local midnight of a date in `zone` (epoch ms; a nonexistent midnight shifts forward). */
export function dayStart(date: string, zone: string): number {
  return wallClockInstant(date, 0, zone);
}

/** The next local midnight after `date` in `zone` (the end of an all-day option). */
export function dayEnd(date: string, zone: string): number {
  return parseDate(date) ? dayStart(addDays(date, 1), zone) : Number.NaN;
}

/** Day of the week of a date (0 = Sunday). */
function weekdayOf(date: string): number {
  const p = parseDate(date);
  return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() : 0;
}

/** Dates of the week containing `date` (weekStart 0 = Sunday, 1 = Monday). */
export function weekDates(date: string, weekStart: 0 | 1 = 0): string[] {
  const offset = (weekdayOf(date) - weekStart + 7) % 7;
  const first = addDays(date, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/**
 * "Copy this day's times to..." (B3.1): every timed option starting on `fromDate` (poll zone) copied to the target
 * dates at the same wall-clock time and duration. Nonexistent target times shift forward; repeated ones take the
 * earlier offset.
 */
export function copyDayTimes(
  options: readonly { start: string; end: string }[],
  fromDate: string,
  toDates: readonly string[],
  zone: string,
): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  const onDay = options.filter((o) => localDate(new Date(o.start).getTime(), zone) === fromDate);
  for (const target of toDates) {
    if (target === fromDate) continue;
    for (const o of onDay) {
      const s = new Date(o.start).getTime();
      const minutes = localMinutes(s, zone);
      const duration = new Date(o.end).getTime() - s;
      const start = wallClockInstant(target, minutes, zone);
      if (Number.isNaN(start)) continue;
      out.push({ start: new Date(start).toISOString(), end: new Date(start + duration).toISOString() });
    }
  }
  return out;
}

export type Interval = { start: number; end: number };

/** Working hours as instants for each date (weekly hours with date overrides; index 0 = Sunday). */
export function workingIntervals(
  schedule: { timeZone: string; weekly: readonly (readonly { start: number; end: number }[])[]; overrides?: Readonly<Record<string, readonly { start: number; end: number }[]>> },
  dates: readonly string[],
): Interval[] {
  const out: Interval[] = [];
  for (const date of dates) {
    if (!parseDate(date)) continue;
    const ranges = schedule.overrides?.[date] ?? schedule.weekly[weekdayOf(date)] ?? [];
    for (const r of ranges) {
      const at = (m: number) => (m >= 1440 ? dayEnd(date, schedule.timeZone) : wallClockInstant(date, m, schedule.timeZone));
      const start = at(r.start);
      const end = at(r.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * "Add all free times" for one day (B3.1): back-to-back options of `durationMinutes` inside the working intervals
 * that overlap the day, starting on `step` boundaries, skipping busy intervals and the past.
 */
export function freeTimesForDay(p: {
  date: string;
  zone: string;
  durationMinutes: number;
  working: readonly Interval[];
  busy: readonly Interval[];
  now: number;
  step?: number;
}): { start: string; end: string }[] {
  const step = (p.step ?? 15) * MIN;
  const dur = p.durationMinutes * MIN;
  const from = dayStart(p.date, p.zone);
  const to = dayEnd(p.date, p.zone);
  const busy = [...p.busy].sort((a, b) => a.start - b.start);
  const out: { start: string; end: string }[] = [];
  for (const w of p.working) {
    const ws = Math.max(w.start, from);
    const we = Math.min(w.end, to);
    let t = ws;
    while (t + dur <= we) {
      const conflict = busy.find((b) => b.start < t + dur && b.end > t);
      if (conflict) {
        // Next step boundary at or after the conflict's end.
        const next = from + Math.ceil((conflict.end - from) / step) * step;
        t = Math.max(next, t + step);
        continue;
      }
      if (t > p.now) out.push({ start: new Date(t).toISOString(), end: new Date(t + dur).toISOString() });
      t += dur;
    }
  }
  return out;
}

/** True when an option overlaps a busy interval (amber outline "Overlaps '{title}'"). */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
