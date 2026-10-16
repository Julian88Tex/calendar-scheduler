// Low-level clock formatting shared by zones.ts and format.ts (SPEC GEN-06). Client and server safe (Intl only).
//
// 12h: "9:00am" (lowercase, no space; the locale's day period, dots and spaces removed). 24h: "09:00".

export type DateLike = Date | number | string;

export function toDate(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value);
}

const cache = new Map<string, Intl.DateTimeFormat>();

/** Cached Intl.DateTimeFormat (constructing formatters is the expensive part). */
export function dtf(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, options);
    } catch {
      f = new Intl.DateTimeFormat("en-US", options);
    }
    if (cache.size > 500) cache.clear();
    cache.set(key, f);
  }
  return f;
}

/** "9:00am" or "09:00" for an instant in `zone`. */
export function formatClock(value: DateLike, zone: string, locale = "en", hour12 = true): string {
  const date = toDate(value);
  if (hour12) {
    const parts = dtf(locale, { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(date);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase().replace(/[\s.\u00a0\u202f]/g, "");
    return `${hour}:${minute}${period}`;
  }
  const parts = dtf(locale, { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = (parts.find((p) => p.type === "hour")?.value ?? "00").padStart(2, "0");
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour === "24" ? "00" : hour}:${minute}`;
}

/** True when the locale prefers a 24-hour clock (GEN-06 default for public pages). */
export function localePrefers24h(locale: string): boolean {
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
    return cycle === "h23" || cycle === "h24";
  } catch {
    return false;
  }
}
