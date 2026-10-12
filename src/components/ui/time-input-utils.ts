// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Pure helpers of TimeInput (server and client safe): minutes from midnight to "9:30am" / "09:30" and back.

/** Formats minutes as "9:30am" (hour12) or "09:30"; 1440 renders as midnight. */
export function formatMinutes(minutes: number, hour12 = true): string {
  const m = minutes % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  if (!hour12) return `${String(minutes === 1440 ? 24 : h).padStart(2, "0")}:${mm}`;
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}:${mm}${suffix}`;
}

/** Parses "9", "930", "9:30", "9:30 pm", "21:30", "12am" into minutes from midnight, or null. */
export function parseTimeInput(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(t);
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
