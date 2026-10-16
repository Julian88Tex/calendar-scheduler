// Curated time zone catalog (SPEC GEN-06, GEN-10, GEN-23; ARCHITECTURE sections 19 and 21).
//
// Friendly names in Calendly style ("Eastern Time - US & Canada"), grouped as US/CANADA, AMERICA, AFRICA, ASIA,
// ATLANTIC, AUSTRALIA, EUROPE, PACIFIC, UTC. Any valid IANA zone (including legacy aliases such as Asia/Calcutta) is
// accepted and stored as given; lookups resolve aliases (Asia/Kolkata and Asia/Calcutta find the same entry) and fall
// back to Intl generic names. English names come from this file (the `zones` i18n namespace mirrors ZONE_NAMES_EN);
// other locales use Intl's localized generic names ("Mitteleuropaeische Zeit" style) unless a catalog is passed.
// Client and server safe (Intl only).
import { dtf, formatClock, type DateLike } from "./clock";

export const ZONE_GROUPS = ["US/CANADA", "AMERICA", "AFRICA", "ASIA", "ATLANTIC", "AUSTRALIA", "EUROPE", "PACIFIC", "UTC"] as const;
export type ZoneGroup = (typeof ZONE_GROUPS)[number];

export type TimeZoneEntry = { id: string; name: string; group: ZoneGroup };

const z = (group: ZoneGroup, id: string, name: string): TimeZoneEntry => ({ id, name, group });

/** The picker list, in display order within each group. */
export const TIME_ZONES: readonly TimeZoneEntry[] = [
  z("US/CANADA", "America/Los_Angeles", "Pacific Time - US & Canada"),
  z("US/CANADA", "America/Denver", "Mountain Time - US & Canada"),
  z("US/CANADA", "America/Chicago", "Central Time - US & Canada"),
  z("US/CANADA", "America/New_York", "Eastern Time - US & Canada"),
  z("US/CANADA", "America/Anchorage", "Alaska Time"),
  z("US/CANADA", "America/Phoenix", "Arizona, Yukon Time"),
  z("US/CANADA", "America/St_Johns", "Newfoundland Time"),
  z("US/CANADA", "Pacific/Honolulu", "Hawaii Time"),

  z("AMERICA", "America/Adak", "Aleutian Time"),
  z("AMERICA", "America/Argentina/Buenos_Aires", "Buenos Aires Time"),
  z("AMERICA", "America/Asuncion", "Asuncion Time"),
  z("AMERICA", "America/Bogota", "Bogota, Jamaica, Lima Time"),
  z("AMERICA", "America/Campo_Grande", "Campo Grande Time"),
  z("AMERICA", "America/Caracas", "Caracas Time"),
  z("AMERICA", "America/Halifax", "Atlantic Time"),
  z("AMERICA", "America/Havana", "Cuba Time"),
  z("AMERICA", "America/La_Paz", "La Paz Time"),
  z("AMERICA", "America/Mazatlan", "Mountain Time - Mexico"),
  z("AMERICA", "America/Mexico_City", "Mexico City Time"),
  z("AMERICA", "America/Montevideo", "Montevideo Time"),
  z("AMERICA", "America/Puerto_Rico", "Puerto Rico Time"),
  z("AMERICA", "America/Regina", "Saskatchewan, Guatemala, Costa Rica Time"),
  z("AMERICA", "America/Santiago", "Chile Time"),
  z("AMERICA", "America/Sao_Paulo", "Brasilia Time"),
  z("AMERICA", "America/Tijuana", "Pacific Time - Mexico"),

  z("AFRICA", "Africa/Cairo", "Egypt Time"),
  z("AFRICA", "Africa/Casablanca", "Morocco Time"),
  z("AFRICA", "Africa/Johannesburg", "South Africa Time"),
  z("AFRICA", "Africa/Lagos", "West Africa Time"),
  z("AFRICA", "Africa/Maputo", "Central Africa Time"),
  z("AFRICA", "Africa/Nairobi", "East Africa Time"),
  z("AFRICA", "Africa/Abidjan", "Ghana, Ivory Coast Time"),

  z("ASIA", "Asia/Amman", "Jordan Time"),
  z("ASIA", "Asia/Baghdad", "Baghdad, East Africa Time"),
  z("ASIA", "Asia/Baku", "Azerbaijan Time"),
  z("ASIA", "Asia/Beirut", "Lebanon Time"),
  z("ASIA", "Asia/Damascus", "Syria Time"),
  z("ASIA", "Asia/Dhaka", "Bangladesh Time"),
  z("ASIA", "Asia/Dubai", "Dubai Time"),
  z("ASIA", "Asia/Hong_Kong", "Hong Kong Time"),
  z("ASIA", "Asia/Irkutsk", "Irkutsk Time"),
  z("ASIA", "Asia/Jakarta", "Western Indonesia Time"),
  z("ASIA", "Asia/Jerusalem", "Israel Time"),
  z("ASIA", "Asia/Kabul", "Kabul Time"),
  z("ASIA", "Asia/Kamchatka", "Kamchatka Time"),
  z("ASIA", "Asia/Karachi", "Pakistan, Maldives Time"),
  z("ASIA", "Asia/Kathmandu", "Kathmandu Time"),
  z("ASIA", "Asia/Calcutta", "India, Sri Lanka Time"),
  z("ASIA", "Asia/Krasnoyarsk", "Krasnoyarsk Time"),
  z("ASIA", "Asia/Kuala_Lumpur", "Malaysia Time"),
  z("ASIA", "Asia/Magadan", "Magadan Time"),
  z("ASIA", "Asia/Manila", "Philippine Time"),
  z("ASIA", "Asia/Omsk", "Omsk Time"),
  z("ASIA", "Asia/Rangoon", "Myanmar Time"),
  z("ASIA", "Asia/Riyadh", "Arabian Time"),
  z("ASIA", "Asia/Seoul", "Korea Time"),
  z("ASIA", "Asia/Shanghai", "China, Singapore, Perth"),
  z("ASIA", "Asia/Bangkok", "Indochina Time"),
  z("ASIA", "Asia/Taipei", "Taipei Time"),
  z("ASIA", "Asia/Tashkent", "Uzbekistan Time"),
  z("ASIA", "Asia/Tehran", "Tehran Time"),
  z("ASIA", "Asia/Tokyo", "Japan, Korea Time"),
  z("ASIA", "Asia/Vladivostok", "Vladivostok Time"),
  z("ASIA", "Asia/Yakutsk", "Yakutsk Time"),
  z("ASIA", "Asia/Yekaterinburg", "Yekaterinburg Time"),
  z("ASIA", "Asia/Yerevan", "Armenia Time"),

  z("ATLANTIC", "Atlantic/Azores", "Azores Time"),
  z("ATLANTIC", "Atlantic/Bermuda", "Bermuda Time"),
  z("ATLANTIC", "Atlantic/Cape_Verde", "Cape Verde Time"),
  z("ATLANTIC", "America/Nuuk", "Greenland Time"),
  z("ATLANTIC", "Atlantic/Reykjavik", "Iceland Time"),
  z("ATLANTIC", "Atlantic/South_Georgia", "Mid-Atlantic Time"),

  z("AUSTRALIA", "Australia/Adelaide", "Adelaide Time"),
  z("AUSTRALIA", "Australia/Brisbane", "Brisbane Time"),
  z("AUSTRALIA", "Australia/Darwin", "Darwin Time"),
  z("AUSTRALIA", "Australia/Hobart", "Hobart Time"),
  z("AUSTRALIA", "Australia/Perth", "Perth Time"),
  z("AUSTRALIA", "Australia/Sydney", "Sydney, Melbourne Time"),

  z("EUROPE", "Europe/London", "UK, Ireland, Lisbon Time"),
  z("EUROPE", "Europe/Berlin", "Central European Time"),
  z("EUROPE", "Europe/Athens", "Eastern European Time"),
  z("EUROPE", "Europe/Istanbul", "Turkey Time"),
  z("EUROPE", "Europe/Kaliningrad", "Kaliningrad Time"),
  z("EUROPE", "Europe/Minsk", "Minsk Time"),
  z("EUROPE", "Europe/Moscow", "Moscow Time"),
  z("EUROPE", "Europe/Samara", "Samara Time"),

  z("PACIFIC", "Pacific/Auckland", "Auckland Time"),
  z("PACIFIC", "Pacific/Chatham", "Chatham Islands Time"),
  z("PACIFIC", "Pacific/Fiji", "Fiji Time"),
  z("PACIFIC", "Pacific/Guam", "Guam, Port Moresby Time"),
  z("PACIFIC", "Pacific/Kiritimati", "Line Islands Time"),
  z("PACIFIC", "Pacific/Majuro", "Marshall Islands Time"),
  z("PACIFIC", "Pacific/Marquesas", "Marquesas Time"),
  z("PACIFIC", "Pacific/Noumea", "Solomon Islands, New Caledonia Time"),
  z("PACIFIC", "Pacific/Pago_Pago", "Samoa Time"),
  z("PACIFIC", "Pacific/Tahiti", "Tahiti Time"),
  z("PACIFIC", "Pacific/Tongatapu", "Tonga Time"),

  z("UTC", "UTC", "UTC Time"),
];

/**
 * Zones that are not in the picker but should show a catalog name (same rules as the entry). Real IANA aliases
 * (Asia/Kolkata, Europe/Kyiv, ...) also resolve through Intl canonicalization.
 */
export const ZONE_ALIASES: Readonly<Record<string, string>> = {
  "US/Pacific": "America/Los_Angeles",
  "America/Vancouver": "America/Los_Angeles",
  "US/Mountain": "America/Denver",
  "America/Edmonton": "America/Denver",
  "America/Boise": "America/Denver",
  "US/Central": "America/Chicago",
  "America/Winnipeg": "America/Chicago",
  "US/Eastern": "America/New_York",
  "America/Detroit": "America/New_York",
  "America/Toronto": "America/New_York",
  "America/Montreal": "America/New_York",
  "America/Indiana/Indianapolis": "America/New_York",
  "America/Kentucky/Louisville": "America/New_York",
  "US/Alaska": "America/Anchorage",
  "US/Arizona": "America/Phoenix",
  "America/Whitehorse": "America/Phoenix",
  "US/Hawaii": "Pacific/Honolulu",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Lima": "America/Bogota",
  "America/Jamaica": "America/Bogota",
  "America/Panama": "America/Bogota",
  "America/Guatemala": "America/Regina",
  "America/Costa_Rica": "America/Regina",
  "America/Godthab": "America/Nuuk",
  "Asia/Kolkata": "Asia/Calcutta",
  "Asia/Colombo": "Asia/Calcutta",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Yangon": "Asia/Rangoon",
  "Asia/Singapore": "Asia/Shanghai",
  "Asia/Ho_Chi_Minh": "Asia/Bangkok",
  "Asia/Saigon": "Asia/Bangkok",
  "Asia/Qatar": "Asia/Riyadh",
  "Asia/Kuwait": "Asia/Riyadh",
  "Asia/Tel_Aviv": "Asia/Jerusalem",
  "Europe/Dublin": "Europe/London",
  "Europe/Lisbon": "Europe/London",
  "Europe/Paris": "Europe/Berlin",
  "Europe/Madrid": "Europe/Berlin",
  "Europe/Rome": "Europe/Berlin",
  "Europe/Amsterdam": "Europe/Berlin",
  "Europe/Brussels": "Europe/Berlin",
  "Europe/Vienna": "Europe/Berlin",
  "Europe/Zurich": "Europe/Berlin",
  "Europe/Stockholm": "Europe/Berlin",
  "Europe/Oslo": "Europe/Berlin",
  "Europe/Copenhagen": "Europe/Berlin",
  "Europe/Warsaw": "Europe/Berlin",
  "Europe/Prague": "Europe/Berlin",
  "Europe/Budapest": "Europe/Berlin",
  "Europe/Belgrade": "Europe/Berlin",
  "Europe/Bucharest": "Europe/Athens",
  "Europe/Helsinki": "Europe/Athens",
  "Europe/Kiev": "Europe/Athens",
  "Europe/Kyiv": "Europe/Athens",
  "Europe/Sofia": "Europe/Athens",
  "Europe/Riga": "Europe/Athens",
  "Europe/Tallinn": "Europe/Athens",
  "Europe/Vilnius": "Europe/Athens",
  "Australia/Melbourne": "Australia/Sydney",
  "Australia/Canberra": "Australia/Sydney",
  "Pacific/Port_Moresby": "Pacific/Guam",
  "Etc/UTC": "UTC",
  "Etc/GMT": "UTC",
  GMT: "UTC",
  "Etc/Universal": "UTC",
};

/** English friendly names keyed by IANA id (the `zones` i18n namespace mirrors this). */
export const ZONE_NAMES_EN: Readonly<Record<string, string>> = Object.fromEntries(TIME_ZONES.map((e) => [e.id, e.name]));

const BY_ID = new Map(TIME_ZONES.map((e) => [e.id, e]));
const canonicalCache = new Map<string, string | null>();

/** Intl canonical name of a zone ("Asia/Kolkata" -> "Asia/Calcutta" in ICU), or null when invalid. */
export function canonicalZone(zone: string): string | null {
  if (canonicalCache.has(zone)) return canonicalCache.get(zone)!;
  let out: string | null = null;
  try {
    out = new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    out = null;
  }
  canonicalCache.set(zone, out);
  return out;
}

let byCanonical: Map<string, TimeZoneEntry> | null = null;

/** The catalog entry for a zone (exact id, alias, or the same Intl canonical zone), or null. */
export function findZoneEntry(zone: string | null | undefined): TimeZoneEntry | null {
  if (!zone) return null;
  const exact = BY_ID.get(zone);
  if (exact) return exact;
  const alias = ZONE_ALIASES[zone];
  if (alias && BY_ID.has(alias)) return BY_ID.get(alias)!;
  if (zone.toUpperCase() === "UTC") return BY_ID.get("UTC")!;
  const canonical = canonicalZone(zone);
  if (!canonical) return null;
  if (!byCanonical) {
    byCanonical = new Map();
    for (const e of TIME_ZONES) {
      const c = canonicalZone(e.id);
      if (c && !byCanonical.has(c)) byCanonical.set(c, e);
    }
    for (const [from, to] of Object.entries(ZONE_ALIASES)) {
      const c = canonicalZone(from);
      const target = BY_ID.get(to);
      if (c && target && !byCanonical.has(c)) byCanonical.set(c, target);
    }
  }
  return byCanonical.get(canonical) ?? null;
}

/** True when Intl accepts the zone (any IANA zone or alias, plus "UTC"). */
export function isValidTimeZone(zone: unknown): zone is string {
  return typeof zone === "string" && zone.length > 0 && zone.length <= 64 && canonicalZone(zone) !== null;
}

/** The zone if valid, else "UTC" (AU-13: "UTC when unknown"). */
export function zoneOrUtc(zone: string | null | undefined): string {
  return zone && isValidTimeZone(zone) ? zone : "UTC";
}

function intlGenericName(zone: string, locale: string): string | null {
  for (const style of ["longGeneric", "long"] as const) {
    try {
      const part = dtf(locale, { timeZone: zone, timeZoneName: style })
        .formatToParts(new Date(Date.UTC(2026, 0, 15)))
        .find((p) => p.type === "timeZoneName")?.value;
      if (part && !/^GMT[+-]?\d*/.test(part)) return part;
    } catch {
      // fall through
    }
  }
  return null;
}

/**
 * Friendly display name: the catalog name for English (or `names[id]` when a localized catalog is given), Intl's
 * localized generic name for other locales, then a readable form of the id ("America/Argentina/Cordoba" ->
 * "Cordoba Time").
 */
export function friendlyZoneName(zone: string, locale = "en", names?: Readonly<Record<string, string>>): string {
  const entry = findZoneEntry(zone);
  if (names) {
    const localized = (entry && names[entry.id]) || names[zone];
    if (localized) return localized;
  }
  const lang = locale.toLowerCase().split(/[-_]/)[0] ?? "en";
  if (lang === "en" && entry) return entry.name;
  if (lang !== "en") {
    const intl = intlGenericName(zone, locale);
    if (intl) return intl;
    if (entry) return entry.name;
  }
  if (entry) return entry.name;
  const intl = intlGenericName(zone, "en");
  if (intl) return intl;
  const city = zone.split("/").pop()?.replace(/_/g, " ") ?? zone;
  return `${city} Time`;
}

/** Current local time in `zone` ("6:53pm" or "18:53"), as shown next to each picker option (GEN-06). */
export function currentLocalTime(
  zone: string,
  opts: { hour12?: boolean; locale?: string; at?: DateLike } = {},
): string {
  return formatClock(opts.at ?? Date.now(), zone, opts.locale ?? "en", opts.hour12 ?? true);
}

export type ZoneOption = TimeZoneEntry & { label: string };

/**
 * Picker groups in GEN-06 order. Includes `extraZone` (for example the stored or detected zone) when it has no
 * catalog entry, under its region group, so the current value is always selectable.
 */
export function groupedZones(
  opts: { locale?: string; names?: Readonly<Record<string, string>>; extraZone?: string | null } = {},
): { group: ZoneGroup; zones: ZoneOption[] }[] {
  const locale = opts.locale ?? "en";
  const groups = new Map<ZoneGroup, ZoneOption[]>(ZONE_GROUPS.map((g) => [g, []]));
  for (const e of TIME_ZONES) groups.get(e.group)!.push({ ...e, label: friendlyZoneName(e.id, locale, opts.names) });
  const extra = opts.extraZone;
  if (extra && isValidTimeZone(extra) && !findZoneEntry(extra)) {
    groups.get(groupForZone(extra))!.push({
      id: extra,
      name: friendlyZoneName(extra, "en"),
      group: groupForZone(extra),
      label: friendlyZoneName(extra, locale, opts.names),
    });
  }
  return ZONE_GROUPS.map((group) => ({ group, zones: groups.get(group)! })).filter((g) => g.zones.length > 0);
}

/** The picker group of any zone (by catalog entry, else by its region prefix). */
export function groupForZone(zone: string): ZoneGroup {
  const entry = findZoneEntry(zone);
  if (entry) return entry.group;
  const region = zone.split("/")[0];
  switch (region) {
    case "America":
      return "AMERICA";
    case "Africa":
      return "AFRICA";
    case "Asia":
      return "ASIA";
    case "Atlantic":
      return "ATLANTIC";
    case "Australia":
      return "AUSTRALIA";
    case "Europe":
      return "EUROPE";
    case "Pacific":
    case "Indian":
    case "Antarctica":
      return "PACIFIC";
    case "Canada":
    case "US":
      return "US/CANADA";
    default:
      return "UTC";
  }
}

/** Case-insensitive search over friendly names and ids ("eastern", "berlin", "new york"). */
export function searchZones(query: string, locale = "en"): TimeZoneEntry[] {
  const q = query.trim().toLowerCase().replace(/[_\s]+/g, " ");
  if (!q) return [...TIME_ZONES];
  return TIME_ZONES.filter((e) => {
    const hay = `${friendlyZoneName(e.id, locale)} ${e.name} ${e.id.replace(/_/g, " ")}`.toLowerCase();
    return hay.includes(q);
  });
}

/** UTC offset of a zone at an instant, in minutes. */
export function offsetMinutesAt(zone: string, at: DateLike = Date.now()): number {
  const d = at instanceof Date ? at : new Date(at);
  const parts = dtf("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
}

/**
 * True when two zones behave the same now and in six months (GEN-23: aliases such as Asia/Kolkata and Asia/Calcutta
 * never trigger the mismatch banner).
 */
export function zonesEquivalent(a: string, b: string, at: DateLike = Date.now()): boolean {
  if (a === b) return true;
  if (!isValidTimeZone(a) || !isValidTimeZone(b)) return false;
  const t = at instanceof Date ? at.getTime() : new Date(at).getTime();
  const later = t + 182 * 24 * 3600_000;
  return offsetMinutesAt(a, t) === offsetMinutesAt(b, t) && offsetMinutesAt(a, later) === offsetMinutesAt(b, later);
}
