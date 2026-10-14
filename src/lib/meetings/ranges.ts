// Date Range presets of the Meetings page (SPEC MT-02 "Date Range: a range picker"): This week, Next week, This month,
// Next 30 days and Last 30 days, from today in the viewer's zone and their week start. Pure: client and server safe.
import { MEETINGS_COPY as C } from "./copy";

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The presets for `today` ("YYYY-MM-DD") with weeks starting on Sunday (0) or Monday (1). */
export function rangePresets(today: string, weekStart: 0 | 1): { label: string; start: string; end: string }[] {
  const offset = (weekday(today) - weekStart + 7) % 7;
  const weekFirst = addDays(today, -offset);
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [
    { label: C.rangePresets.thisWeek, start: weekFirst, end: addDays(weekFirst, 6) },
    { label: C.rangePresets.nextWeek, start: addDays(weekFirst, 7), end: addDays(weekFirst, 13) },
    { label: C.rangePresets.thisMonth, start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` },
    { label: C.rangePresets.next30, start: today, end: addDays(today, 29) },
    { label: C.rangePresets.last30, start: addDays(today, -29), end: today },
  ];
}
