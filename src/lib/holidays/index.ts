// OWNER: slot-engine. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Public holidays for the 10 supported countries (SPEC AV-13, ARCHITECTURE section 7.1). Keys are stable and year
// independent: '{country}:{rule id}', observed and substitute days append ':substitute'. A holiday is observed
// (unavailable) unless user_holiday_overrides has a row with observed = false.
// The rule id is the holiday's date-holidays rule reduced to its date expression ("01-01", "easter_-2",
// "4th_thursday_in_november"), so the key is the same every year and survives name changes. Names are English. The
// United Kingdom uses the England and Wales bank holiday calendar. Pure, no I/O. Server only (the rule data is large and
// data.ts imports "server-only"); client code imports the country list from "@/lib/holidays/countries".
import { isValidTimeZone, zoneClock } from "@/lib/slots/zone";
import { isSupportedCountry, type Holiday, type HolidayOverrides, type SupportedCountry } from "./countries";
import { rawHolidays, type RawHoliday } from "./data";

export { COUNTRY_NAMES, SUPPORTED_COUNTRIES, isSupportedCountry, type Holiday, type HolidayOverrides, type SupportedCountry } from "./countries";

/** Clearer English names where date-holidays' translation is generic or missing (keyed by holiday key). */
const NAME_OVERRIDES: Readonly<Record<string, string>> = {
  "DE:10-03": "German Unity Day",
  "ES:10-12": "National Day of Spain",
  "ES:12-06": "Constitution Day",
};

const SUBSTITUTE_SUFFIX = " (substitute day)";
const MODIFIER = /\s+(?:and\s+if|if|since|prior\s+to|in\s+(?:even|odd)\s+years|every|on\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?)\b/i;

/** The year independent rule id of a date-holidays rule: its date expression without substitution modifiers. */
export function ruleId(rule: string): string {
  let r = rule.trim().replace(/^substitutes\s+/i, "");
  const cut = r.search(MODIFIER);
  if (cut > 0) r = r.slice(0, cut);
  return (
    r
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_+-]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "rule"
  );
}

/** The stable key of a holiday. */
export function holidayKey(country: SupportedCountry, rule: string, substitute: boolean): string {
  return `${country}:${ruleId(rule)}${substitute ? ":substitute" : ""}`;
}

function toHoliday(country: SupportedCountry, raw: RawHoliday): Holiday {
  const key = holidayKey(country, raw.rule, raw.substitute);
  const baseKey = key.replace(/:substitute$/, "");
  const override = NAME_OVERRIDES[baseKey];
  let name = raw.name;
  if (override) name = raw.substitute ? `${override}${SUBSTITUTE_SUFFIX}` : override;
  else if (raw.substitute && !/substitute/i.test(name)) name = `${name}${SUBSTITUTE_SUFFIX}`;
  return { key, date: raw.date, name, substitute: raw.substitute };
}

/**
 * date-holidays reports some moved days as a second entry of the same rule without the substitute flag (Australia:
 * "01-01 and if saturday,sunday then next monday" gives Sat Jan 1 and Mon Jan 3, both plain). Such a second entry is
 * the substitute day: it keeps its own row and key instead of being dropped as a duplicate. The original is the entry
 * on the rule's fixed date ("01-01"), else the earliest one.
 */
function withSubstituteFlags(country: SupportedCountry, list: readonly RawHoliday[]): RawHoliday[] {
  const groups = new Map<string, RawHoliday[]>();
  for (const raw of list) {
    if (raw.substitute) continue;
    const key = holidayKey(country, raw.rule, false);
    const g = groups.get(key);
    if (g) g.push(raw);
    else groups.set(key, [raw]);
  }
  const moved = new Set<RawHoliday>();
  for (const [key, g] of groups) {
    if (g.length < 2) continue;
    const fixed = /^[A-Z]{2}:(\d{2}-\d{2})$/.exec(key)?.[1];
    const sorted = [...g].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const original = (fixed ? sorted.find((h) => h.date.slice(5) === fixed) : undefined) ?? sorted[0]!;
    for (const h of g) if (h !== original) moved.add(h);
  }
  if (moved.size === 0) return [...list];
  return list.map((h) => (moved.has(h) ? { ...h, substitute: true } : h));
}

const MIN_YEAR = 1970;
const MAX_YEAR = 2200;
const memo = new Map<string, readonly Holiday[]>();

/** Public holidays of one country and year, sorted by date. */
export function getHolidays(country: string, year: number): Holiday[] {
  const c = typeof country === "string" ? country.toUpperCase() : "";
  if (!isSupportedCountry(c) || !Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return [];
  const memoKey = `${c}:${year}`;
  let list = memo.get(memoKey);
  if (!list) {
    const seen = new Set<string>();
    const out: Holiday[] = [];
    for (const raw of withSubstituteFlags(c, rawHolidays(c, year))) {
      const h = toHoliday(c, raw);
      // The same rule never yields two entries of one kind in a year; keep the first if data ever repeats one.
      if (seen.has(h.key)) continue;
      seen.add(h.key);
      out.push(h);
    }
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.substitute) - Number(b.substitute) || a.name.localeCompare(b.name)));
    list = Object.freeze(out.map((h) => Object.freeze(h)));
    if (memo.size > 2000) memo.clear();
    memo.set(memoKey, list);
  }
  return list.map((h) => ({ ...h }));
}

/** Holidays of `country` with dates in [fromDate, toDate] (inclusive "YYYY-MM-DD"), sorted by date. */
export function holidaysBetween(country: string, fromDate: string, toDate: string): Holiday[] {
  if (!ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate) || fromDate > toDate) return [];
  const out: Holiday[] = [];
  for (let y = Number(fromDate.slice(0, 4)); y <= Number(toDate.slice(0, 4)); y++) {
    for (const h of getHolidays(country, y)) if (h.date >= fromDate && h.date <= toDate) out.push(h);
  }
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function localDate(input: Date | string, zone: string): string | null {
  if (typeof input === "string" && ISO_DATE.test(input)) return input;
  const ms = input instanceof Date ? input.getTime() : typeof input === "string" ? Date.parse(input) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  const clock = zoneClock(isValidTimeZone(zone) ? zone : "UTC");
  return new Date(clock.localDay(ms) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Dates (YYYY-MM-DD, local to `zone`) between rangeStart and rangeEnd (inclusive dates; instants are converted to
 * their local date in `zone`) that are observed holidays of `country`, honoring the user's overrides.
 */
export function blockedDatesFor(
  country: string | null | undefined,
  overrides: HolidayOverrides,
  rangeStart: Date | string,
  rangeEnd: Date | string,
  zone: string,
): string[] {
  if (!country || !isSupportedCountry(country.toUpperCase())) return [];
  const from = localDate(rangeStart, zone);
  const to = localDate(rangeEnd, zone);
  if (!from || !to || from > to) return [];
  const dates = new Set<string>();
  for (const h of holidaysBetween(country, from, to)) {
    if (overrides?.[h.key] === false) continue;
    dates.add(h.date);
  }
  return [...dates].sort();
}
