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
import { DateTime } from "@/lib/time/luxon";

const MIN = 60_000;

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
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const base = DateTime.fromObject({ year: y, month: mo, day: d, hour, minute }, { zone });
  if (!base.isValid) return [];
  // Luxon shifts nonexistent times forward: the wall clock then differs from the request.
  if (base.hour !== hour || base.minute !== minute || base.day !== d) return [];
  const out = [base.toMillis()];
  // A repeated wall time: the same wall clock one offset change later.
  for (const shift of [30, 60, 120]) {
    const later = DateTime.fromMillis(base.toMillis() + shift * MIN, { zone });
    if (later.hour === hour && later.minute === minute && later.day === d && later.offset !== base.offset) {
      out.push(later.toMillis());
      break;
    }
  }
  return out;
}

/** Short zone abbreviation at an instant ("EDT", "EST"; "GMT+2" style when the zone has none). */
export function offsetLabelAt(instant: number, zone: string, locale = "en-US"): string {
  return DateTime.fromMillis(instant, { zone }).setLocale(locale).toFormat("ZZZZ");
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
  return DateTime.fromMillis(instant, { zone }).toISODate()!;
}

/** Wall-clock minutes after local midnight of an instant in `zone`. */
export function localMinutes(instant: number, zone: string): number {
  const dt = DateTime.fromMillis(instant, { zone });
  return dt.hour * 60 + dt.minute;
}

/** Local midnight of a date in `zone` (epoch ms; a nonexistent midnight shifts forward). */
export function dayStart(date: string, zone: string): number {
  return DateTime.fromISO(date, { zone }).startOf("day").toMillis();
}

/** The next local midnight after `date` in `zone` (the end of an all-day option). */
export function dayEnd(date: string, zone: string): number {
  return DateTime.fromISO(date, { zone }).plus({ days: 1 }).startOf("day").toMillis();
}

/** Dates of the week containing `date` (weekStart 0 = Sunday, 1 = Monday). */
export function weekDates(date: string, weekStart: 0 | 1 = 0): string[] {
  const d = DateTime.fromISO(date, { zone: "utc" });
  const weekday = d.weekday % 7; // 0 = Sunday
  const offset = (weekday - weekStart + 7) % 7;
  const first = d.minus({ days: offset });
  return Array.from({ length: 7 }, (_, i) => first.plus({ days: i }).toISODate()!);
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
      const [y, mo, d] = target.split("-").map(Number) as [number, number, number];
      const start = DateTime.fromObject({ year: y, month: mo, day: d, hour: Math.floor(minutes / 60), minute: minutes % 60 }, { zone }).toMillis();
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
    const weekday = DateTime.fromISO(date, { zone: "utc" }).weekday % 7;
    const ranges = schedule.overrides?.[date] ?? schedule.weekly[weekday] ?? [];
    const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
    for (const r of ranges) {
      const at = (m: number) =>
        m >= 1440
          ? DateTime.fromObject({ year: y, month: mo, day: d }, { zone: schedule.timeZone }).plus({ days: 1 }).startOf("day").toMillis()
          : DateTime.fromObject({ year: y, month: mo, day: d, hour: Math.floor(m / 60), minute: m % 60 }, { zone: schedule.timeZone }).toMillis();
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
