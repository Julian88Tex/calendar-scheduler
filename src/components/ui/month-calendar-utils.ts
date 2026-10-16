// OWNER: foundation-ui.
//
// Pure date helpers of MonthCalendar, DatePicker and DateRangePicker (server and client safe). Dates are local
// "YYYY-MM-DD" strings and months "YYYY-MM"; the math uses UTC midnights only to count days, so no time zone is
// involved.

const pad = (n: number) => String(n).padStart(2, "0");

export function isMonthString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function isDateString(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Days between two dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const toMs = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toMs(b) - toMs(a)) / 86_400_000);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Day of week of a date, 0 = Sunday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The weeks of a month as rows of 7 cells; cells outside the month are null (rendered hidden, Calendly parity).
 * weekStart 0 = Sunday first, 1 = Monday first.
 */
export function monthGrid(month: string, weekStart: 0 | 1 = 0): (string | null)[][] {
  const first = `${month}-01`;
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const total = daysInMonth(month);
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: total }, (_, i) => `${month}-${pad(i + 1)}`)];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** "Monday, October 12" in the locale (the day button label prefix, SPEC GEN-05). */
export function dayLabel(date: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** "October 2026" in the locale. */
export function monthLabel(month: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

/** "October" in the locale (live region "October is now displayed"). */
export function monthName(month: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Weekday headers in display order: short ("Sun") and long ("Sunday") names. */
export function weekdayNames(locale = "en", weekStart: 0 | 1 = 0): { short: string; long: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.UTC(2023, 0, 1 + ((i + weekStart) % 7)));
    return {
      short: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date),
      long: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date),
    };
  });
}

/** "Oct 14, 2026" style short date for date picker triggers. */
export function shortDateLabel(date: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** Today's local date in a zone (or the browser zone), as "YYYY-MM-DD". */
export function todayIn(zone?: string, at: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
