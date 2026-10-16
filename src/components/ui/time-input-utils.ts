// OWNER: foundation-ui.
//
// Pure helpers of TimeInput (server and client safe): minutes from midnight to "9:30am" / "09:30" and back, and the
// option list with type-ahead matching.

/** Formats minutes as "9:30am" (hour12) or "09:30"; 1440 renders as midnight ("12:00am" or "24:00"). */
export function formatMinutes(minutes: number, hour12 = true): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  if (!hour12) return `${String(minutes === 1440 ? 24 : h).padStart(2, "0")}:${mm}`;
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}:${mm}${suffix}`;
}

/**
 * Parses typed times into minutes from midnight, or null:
 * "9" -> 540, "930" -> 570, "0930" -> 570, "9:30" -> 570, "9.30" -> 570, "9:30 pm" -> 1290, "9p" -> 1260,
 * "21:30" -> 1290, "2130" -> 1290, "12am" -> 0, "12pm" -> 720, "noon" -> 720, "midnight" -> 0, "24:00" -> 1440.
 * Hours without am/pm are read on the 24-hour clock ("5" is 5:00am).
 */
export function parseTimeInput(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, ":");
  if (t === "noon") return 720;
  if (t === "midnight") return 0;
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p|a:m:|p:m:)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.[0];
  if (min > 59 || h > 24) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "a" && h === 12) h = 0;
    else if (ap === "p" && h !== 12) h += 12;
  }
  const total = h * 60 + min;
  return total > 1440 ? null : total;
}

/** The option values from min to max (inclusive) every `step` minutes; 1440 only with allowEndOfDay. */
export function timeOptions(opts: { step?: number; min?: number; max?: number; allowEndOfDay?: boolean } = {}): number[] {
  const step = Math.max(1, opts.step ?? 15);
  const min = Math.max(0, opts.min ?? 0);
  const max = Math.min(opts.allowEndOfDay ? 1440 : 1439, opts.max ?? 1440);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

/**
 * The option to highlight while typing: the exact parsed value when it is an option, otherwise the first option
 * whose label starts with the typed text (ignoring spaces and the colon), otherwise the nearest option at or after
 * the parsed value.
 */
export function matchTimeOption(text: string, options: readonly number[], hour12 = true): number | null {
  const typed = text.trim().toLowerCase().replace(/[\s:.]/g, "");
  if (!typed) return null;
  const parsed = parseTimeInput(text);
  if (parsed !== null && options.includes(parsed)) return parsed;
  const prefix = options.find((o) => formatMinutes(o, hour12).replace(":", "").startsWith(typed));
  if (prefix !== undefined) return prefix;
  if (parsed !== null) return options.find((o) => o >= parsed) ?? null;
  return null;
}
