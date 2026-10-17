// Month slots of the booking calendar (SPEC BK-04, BK-06, BK-31, BK-33). Pure and client safe: the response shape of
// GET /api/public/slots, the month range of a request, the slots query string, and the "Conflict" marks of mutual
// availability.
import { daysInMonth } from "@/components/ui/month-calendar-utils";

export type SlotEntry = { start: string; remaining: number };

export type TroubleshootBlockerView = {
  code: string;
  source: string;
  start: number;
  end: number;
  title: string | null;
  bufferSide: "before" | "after" | null;
  inviteeNames: string[];
};

export type TroubleshootCandidateView = {
  start: number;
  end: number;
  available: boolean;
  reasons: string[];
  status: string;
  outsideHours: boolean;
  limitPeriods: string[];
  hostLimitPeriods: string[];
  blockers: TroubleshootBlockerView[];
};

export type MonthSlots = {
  timeZone: string;
  durationMinutes: number;
  days: Record<string, SlotEntry[]>;
  firstAvailableDate?: string;
  windowEnd: string | null;
  troubleshoot?: { days: Record<string, TroubleshootCandidateView[]> };
};

/** First and last date of a month ("2026-10" -> ["2026-10-01", "2026-10-31"]). */
export function monthRange(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` };
}

export type SlotsRequest = {
  target: string;
  month: string;
  zone: string;
  duration: number | null;
  troubleshoot?: boolean;
  first?: boolean;
  reschedule?: string | null;
};

/** The GET /api/public/slots URL of one month. */
export function slotsUrl(r: SlotsRequest): string {
  const { start, end } = monthRange(r.month);
  const q = new URLSearchParams({ target: r.target, start, end, tz: r.zone });
  if (r.duration) q.set("duration", String(r.duration));
  if (r.troubleshoot) q.set("troubleshoot", "1");
  if (r.first) q.set("first", "1");
  if (r.reschedule) q.set("reschedule", r.reschedule);
  return `/api/public/slots?${q.toString()}`;
}

/** Cache key of a month request. */
export function slotsKey(r: SlotsRequest): string {
  return `${r.target}|${r.zone}|${r.duration ?? ""}|${r.month}|${r.troubleshoot ? 1 : 0}|${r.reschedule ?? ""}`;
}

/** Dates of a month with at least one slot. */
export function availableDatesOf(data: MonthSlots | null | undefined, month: string): string[] {
  if (!data) return [];
  return Object.entries(data.days)
    .filter(([d, list]) => d.startsWith(`${month}-`) && list.length > 0)
    .map(([d]) => d)
    .sort();
}

/** A busy range of the viewer (epoch ms); title: the name of the visitor's own event, when they allowed reading it. */
export type BusyRange = { start: number; end: number; title?: string };

/**
 * Whether [start, start + duration) overlaps the viewer's busy ranges (BK-33): undefined when free, else the names of
 * the visitor's own events it overlaps, in start order and each once ([] when none of them is named).
 */
export function conflictOf(startIso: string, durationMinutes: number, busy: readonly BusyRange[]): string[] | undefined {
  const s = Date.parse(startIso);
  const e = s + durationMinutes * 60_000;
  const hits = busy.filter((b) => b.start < e && b.end > s);
  if (!hits.length) return undefined;
  return [...new Set(hits.sort((a, b) => a.start - b.start).flatMap((b) => (b.title ? [b.title] : [])))];
}

/** The month after `month` ("2026-12" -> "2027-01"). */
export function nextMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Months from a to b (b - a), e.g. "2026-10" to "2027-01" is 3. */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
}
