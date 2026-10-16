// Booking page "Compare with my calendar" (a visitor connects their own Google Calendar for a while and sees which of
// the host's open times clash with their own events). Client and server safe: limits, the cookie name and the paths.

/** The query parameter that reopens the compare panel after the Google round trip (?compare=1). */
export const COMPARE_PARAM = "compare";

/** The sealed visitor token cookie: httpOnly, sent only to COMPARE_API_PATH. Never stored server side. */
export const COMPARE_COOKIE = "kairos_compare";
export const COMPARE_API_PATH = "/api/public/compare";

/** The visitor's connection lasts as long as Google's access token, and never more than an hour. */
export const COMPARE_MAX_AGE_SECONDS = 60 * 60;

/** One busy request covers at most this many calendars and days (a month view with its edges needs about 33). */
export const COMPARE_MAX_CALENDARS = 20;
export const COMPARE_MAX_DAYS = 45;

/** Busy lookups per visitor connection per hour (each month the visitor opens is one lookup). */
export const COMPARE_BUSY_PER_HOUR = 60;

/**
 * Why Google could not read one of the visitor's calendars. no_access: Google's free/busy said notFound, which it does
 * for calendars it won't share busy times of (holiday and other subscribed calendars, some shared ones). temporary:
 * Google's own error, worth a retry. too_many: Google refused that many calendars in one lookup.
 */
export type CompareFailureReason = "no_access" | "temporary" | "too_many" | "unknown";
export type CompareFailure = { id: string; reason: CompareFailureReason };
