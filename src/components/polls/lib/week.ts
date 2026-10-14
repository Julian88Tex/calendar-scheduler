// Week grid model of the poll creation calendar (SPEC MP-02, MP-29; research meeting-polls.md B3.1, B20). Pure and
// client safe; built on polls-core's grid helpers (src/lib/polls/grid.ts) so every cell is a correct UTC instant.
//
// Rows are wall-clock times of the grid zone every 15 minutes. Unlike gridRows() (which interleaves the repeated fall
// back rows), the repeated hour is laid out as one contiguous block ("1:00am (EDT)" ... then "1:00am (EST)" ...), so on
// every date the instants of the "ok" cells increase from top to bottom and blocks map to one continuous span. A wall
// time missing on a date (spring forward) is a "nonexistent" cell (hatched "Doesn't exist (DST)"); the repeated rows
// are "absent" on dates without a repeated hour.
import { dayEnd, dayStart, instantsForWallTime, offsetLabelAt } from "@/lib/polls/grid";

export const STEP_MINUTES = 15;
export const STEP_MS = STEP_MINUTES * 60_000;
export const ROWS_PER_HOUR = 60 / STEP_MINUTES;

export type WeekCell = { state: "ok"; start: number; past: boolean } | { state: "nonexistent" } | { state: "absent" };

export type WeekRow = {
  index: number;
  /** Wall-clock minutes after local midnight. */
  minutes: number;
  /** 0: first (or only) occurrence; 1: the repeated fall back occurrence. */
  variant: 0 | 1;
  /** Gutter label on full hours ("9am", "1am (EST)"), else null. */
  hourLabel: string | null;
};

export type WeekModel = {
  zone: string;
  dates: string[];
  rows: WeekRow[];
  /** Cells per date, indexed like `rows`. */
  cells: Record<string, WeekCell[]>;
  /** The ok cells of each date in instant order (row index and start). */
  index: Record<string, { row: number; start: number }[]>;
  /** Local midnight to the next local midnight of each date. */
  bounds: Record<string, { start: number; end: number }>;
};

/** "9am" / "12pm" (12h) or "09:00" (24h) for wall-clock minutes. */
export function hourText(minutes: number, hour12: boolean): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  if (!hour12) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const suffix = h < 12 ? "am" : "pm";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${suffix}` : `${hh}${suffix}`;
}

export function buildWeekModel(dates: readonly string[], zone: string, opts: { now: number; hour12: boolean }): WeekModel {
  const slots = 1440 / STEP_MINUTES;
  const instants: Record<string, number[][]> = {};
  const ambiguous = new Set<number>();
  for (const d of dates) {
    const perDay: number[][] = [];
    for (let i = 0; i < slots; i++) {
      const xs = instantsForWallTime(d, i * STEP_MINUTES, zone);
      perDay.push(xs);
      if (xs.length > 1) ambiguous.add(i * STEP_MINUTES);
    }
    instants[d] = perDay;
  }
  // Row order: the repeated block follows the first block of the same wall times.
  const order: { minutes: number; variant: 0 | 1 }[] = [];
  for (let m = 0; m < 1440; ) {
    if (ambiguous.has(m)) {
      const block: number[] = [];
      while (m < 1440 && ambiguous.has(m)) {
        block.push(m);
        m += STEP_MINUTES;
      }
      for (const b of block) order.push({ minutes: b, variant: 0 });
      for (const b of block) order.push({ minutes: b, variant: 1 });
    } else {
      order.push({ minutes: m, variant: 0 });
      m += STEP_MINUTES;
    }
  }
  const ambiguousDate = dates.find((d) => instants[d]!.some((xs) => xs.length > 1)) ?? null;
  const rows: WeekRow[] = order.map((o, index) => {
    let hourLabel: string | null = null;
    if (o.minutes % 60 === 0) {
      hourLabel = hourText(o.minutes, opts.hour12);
      if (ambiguousDate && ambiguous.has(o.minutes)) {
        const xs = instants[ambiguousDate]![o.minutes / STEP_MINUTES]!;
        const at = xs[o.variant] ?? xs[0];
        if (at !== undefined) hourLabel = `${hourLabel} (${offsetLabelAt(at, zone)})`;
      }
    }
    return { index, minutes: o.minutes, variant: o.variant, hourLabel };
  });
  const cells: Record<string, WeekCell[]> = {};
  const index: Record<string, { row: number; start: number }[]> = {};
  const bounds: Record<string, { start: number; end: number }> = {};
  for (const d of dates) {
    const list: WeekCell[] = [];
    const ok: { row: number; start: number }[] = [];
    rows.forEach((r) => {
      const xs = instants[d]![r.minutes / STEP_MINUTES]!;
      if (!xs.length) list.push(r.variant === 0 ? { state: "nonexistent" } : { state: "absent" });
      else if (r.variant === 1 && xs.length < 2) list.push({ state: "absent" });
      else {
        const start = xs[r.variant]!;
        list.push({ state: "ok", start, past: start < opts.now });
        ok.push({ row: r.index, start });
      }
    });
    ok.sort((a, b) => a.start - b.start);
    cells[d] = list;
    index[d] = ok;
    bounds[d] = { start: dayStart(d, zone), end: dayEnd(d, zone) };
  }
  return { zone, dates: [...dates], rows, cells, index, bounds };
}

/** Vertical position (px) of an instant in a date's column. */
export function yOf(model: WeekModel, date: string, t: number, rowHeight: number): number {
  const list = model.index[date] ?? [];
  if (!list.length) return 0;
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return list[0]!.row * rowHeight;
  const cell = list[found]!;
  const frac = Math.min(1, Math.max(0, (t - cell.start) / STEP_MS));
  return (cell.row + frac) * rowHeight;
}

/**
 * The instant at a vertical position of a date's column, snapped to `snapMinutes` inside the row ("floor": the slot
 * under the pointer; "round": the nearest boundary, for drag ends). Null over a nonexistent or absent cell.
 */
export function instantAt(model: WeekModel, date: string, y: number, rowHeight: number, opts: { snapMinutes?: number; mode?: "floor" | "round" } = {}): number | null {
  const rows = model.rows.length;
  const snap = Math.max(1, Math.min(STEP_MINUTES, opts.snapMinutes ?? STEP_MINUTES));
  const mode = opts.mode ?? "floor";
  const clamped = Math.max(0, Math.min(rows * rowHeight, y));
  let row = Math.floor(clamped / rowHeight);
  let minutesIn = ((clamped - row * rowHeight) / rowHeight) * STEP_MINUTES;
  minutesIn = mode === "round" ? Math.round(minutesIn / snap) * snap : Math.floor(minutesIn / snap) * snap;
  if (minutesIn >= STEP_MINUTES) {
    row += 1;
    minutesIn = 0;
  }
  if (row >= rows) return model.bounds[date]?.end ?? null;
  const cell = model.cells[date]?.[row];
  if (!cell || cell.state !== "ok") {
    if (mode !== "round") return null;
    // A drag end on a gap row: the next real instant below it.
    const next = (model.index[date] ?? []).find((c) => c.row > row);
    return next ? next.start : (model.bounds[date]?.end ?? null);
  }
  return cell.start + minutesIn * 60_000;
}

export type Segment = { date: string; top: number; bottom: number; continuesBefore: boolean; continuesAfter: boolean };

/** The parts of an interval inside each visible date (an option crossing local midnight renders as two segments). */
export function segmentsFor(model: WeekModel, interval: { start: number; end: number }, rowHeight: number): Segment[] {
  const out: Segment[] = [];
  for (const d of model.dates) {
    const b = model.bounds[d]!;
    const s = Math.max(interval.start, b.start);
    const e = Math.min(interval.end, b.end);
    if (e <= s) continue;
    const top = yOf(model, d, s, rowHeight);
    const bottom = e >= b.end ? model.rows.length * rowHeight : yOf(model, d, e, rowHeight);
    out.push({ date: d, top, bottom: Math.max(bottom, top + Math.min(rowHeight, 8)), continuesBefore: interval.start < b.start, continuesAfter: interval.end > b.end });
  }
  return out;
}

/**
 * Side-by-side layout of overlapping items (calendar style): each cluster of overlapping items shares the column
 * width; items get the first free lane.
 */
export function assignLanes<T extends { start: number; end: number }>(items: readonly T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: (T & { lane: number; lanes: number })[] = [];
  let cluster: (T & { lane: number; lanes: number })[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes = cluster.reduce((m, c) => Math.max(m, c.lane + 1), 1);
    for (const c of cluster) c.lanes = lanes;
    out.push(...cluster);
    cluster = [];
  };
  for (const item of sorted) {
    if (cluster.length && item.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? -Infinity, c.end);
    let lane = 0;
    while (laneEnds[lane] !== undefined && laneEnds[lane]! > item.start) lane++;
    cluster.push({ ...item, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length) flush();
  return out;
}

/** The row to scroll to first: working hours start, else 7am. */
export function initialScrollRow(model: WeekModel, workingStartMinutes: number | null): number {
  const target = workingStartMinutes ?? 7 * 60;
  const row = model.rows.find((r) => r.variant === 0 && r.minutes >= Math.max(0, target - 30));
  return row?.index ?? 0;
}
