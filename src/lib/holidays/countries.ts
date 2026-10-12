// Holiday countries and types (SPEC AV-13), without the holiday rule data. Client safe: the Holidays settings UI can
// import the country list from "@/lib/holidays/countries" without pulling date-holidays (server only, see data.ts)
// into a client bundle. "@/lib/holidays" re-exports everything here.

export const SUPPORTED_COUNTRIES = ["AU", "BR", "CA", "FR", "DE", "MX", "NL", "ES", "GB", "US"] as const;
export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];

/** English display names for the Holidays country select (AV-13), in SUPPORTED_COUNTRIES order. */
export const COUNTRY_NAMES: Readonly<Record<SupportedCountry, string>> = {
  AU: "Australia",
  BR: "Brazil",
  CA: "Canada",
  FR: "France",
  DE: "Germany",
  MX: "Mexico",
  NL: "Netherlands",
  ES: "Spain",
  GB: "United Kingdom",
  US: "United States",
};

export type Holiday = {
  /** '{country}:{stable rule id}', e.g. 'US:4th_thursday_in_november'; substitute days end with ':substitute'. */
  key: string;
  /** Local calendar date YYYY-MM-DD. */
  date: string;
  name: string;
  substitute: boolean;
};

/** holidayKey -> observed (rows of user_holiday_overrides; a missing key means observed). */
export type HolidayOverrides = Readonly<Record<string, boolean>>;

export function isSupportedCountry(value: unknown): value is SupportedCountry {
  return typeof value === "string" && (SUPPORTED_COUNTRIES as readonly string[]).includes(value);
}
