// Dates of the "Active sessions" list (SPEC BR-10, AU-05): "Logged in Oct 12, 2026" and "Last active today",
// "yesterday" or a date, in the profile time zone. Pure and client and server safe. A zone the browser's Intl data does
// not know (newer IANA zones on older browsers) falls back to UTC instead of throwing during render.

/** The zone when this runtime's Intl knows it, else "UTC". */
export function safeTimeZone(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/** "2026-10-12": the calendar day of an instant in the zone. */
export function dayKey(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: safeTimeZone(zone), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** The calendar day before a "YYYY-MM-DD" key (calendar arithmetic: correct across 23 and 25 hour DST days). */
export function previousDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** "Oct 12, 2026" in the zone. */
export function formatSessionDate(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: safeTimeZone(zone), month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

/** "today", "yesterday" or "Oct 12, 2026" (sessions record activity once a day). */
export function lastActiveLabel(iso: string, zone: string, nowIso: string): string {
  const day = dayKey(iso, zone);
  const today = dayKey(nowIso, zone);
  if (day === today) return "today";
  if (day === previousDayKey(today)) return "yesterday";
  return formatSessionDate(iso, zone);
}
