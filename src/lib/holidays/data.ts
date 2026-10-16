// Thin wrapper over date-holidays (ARCHITECTURE section 7.1): public holidays only, observed and substitute days kept
// as their own entries, memoized per country and year. English names (US English for the United States).
// The United Kingdom uses the England and Wales bank holiday calendar (the gov.uk default list, which includes the
// Summer bank holiday); date-holidays' country level GB omits the holidays that differ between UK nations.
// Server-side data (the rule set is large): "server-only" keeps it out of client bundles.
import "server-only";
import Holidays from "date-holidays";

export type RawHoliday = { date: string; name: string; rule: string; substitute: boolean };

export type SourceCountry = "AU" | "BR" | "CA" | "FR" | "DE" | "MX" | "NL" | "ES" | "GB" | "US";

const SOURCES: Record<SourceCountry, { state?: string; languages: string[] }> = {
  AU: { languages: ["en"] },
  BR: { languages: ["en"] },
  CA: { languages: ["en"] },
  FR: { languages: ["en"] },
  DE: { languages: ["en"] },
  MX: { languages: ["en"] },
  NL: { languages: ["en"] },
  ES: { languages: ["en"] },
  GB: { state: "ENG", languages: ["en"] },
  US: { languages: ["en-us", "en"] },
};

const instances = new Map<SourceCountry, Holidays>();
const cache = new Map<string, readonly RawHoliday[]>();

function instance(country: SourceCountry): Holidays {
  let hd = instances.get(country);
  if (!hd) {
    const src = SOURCES[country];
    const opts = { types: ["public" as const], languages: src.languages };
    hd = src.state ? new Holidays(country, src.state, opts) : new Holidays(country, opts);
    instances.set(country, hd);
  }
  return hd;
}

/** Public holidays of a supported country in one calendar year (dates inside that year), memoized. */
export function rawHolidays(country: SourceCountry, year: number): readonly RawHoliday[] {
  const key = `${country}:${year}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const list: RawHoliday[] = [];
  for (const h of instance(country).getHolidays(year)) {
    if (h.type !== "public") continue;
    const date = String(h.date).slice(0, 10);
    if (!date.startsWith(`${year}-`)) continue;
    list.push({ date, name: String(h.name), rule: String(h.rule ?? ""), substitute: h.substitute === true });
  }
  const frozen = Object.freeze(list.map((h) => Object.freeze(h)));
  if (cache.size > 2000) cache.clear();
  cache.set(key, frozen);
  return frozen;
}
