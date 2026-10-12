// OWNER: slot-engine. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Public holidays for the 10 supported countries (SPEC AV-13, ARCHITECTURE section 7.1). Keys are stable and year
// independent: '{country}:{rule id}', observed and substitute days append ':substitute'. A holiday is observed
// (unavailable) unless user_holiday_overrides has a row with observed = false.
// Foundation stub: no holidays (getHolidays returns [], blockedDatesFor returns []). Pure, no I/O.

export const SUPPORTED_COUNTRIES = ["AU", "BR", "CA", "FR", "DE", "MX", "NL", "ES", "GB", "US"] as const;
export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];

export type Holiday = {
  /** '{country}:{stable rule id}', e.g. 'US:thanksgiving'; substitute days end with ':substitute'. */
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

/** Public holidays of one country and year, sorted by date. */
export function getHolidays(country: string, year: number): Holiday[] {
  void country;
  void year;
  return [];
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
  void overrides;
  void rangeStart;
  void rangeEnd;
  void zone;
  if (!country || !isSupportedCountry(country)) return [];
  return [];
}
