// OWNER: booking-core. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Booking contract (ARCHITECTURE sections 8 and 9): target resolution, the availability service (DB to slot engine),
// booking creation, reservations and the global lock order helpers; plus (additive) email verification, the
// Troubleshoot view data, the public endpoint services, bot protection and the pure helpers below.
//
// Global lock order (normative): 1. lockHostsInTx (advisory locks per host, ascending user id); 2. row locks: the
// invitee being changed (lockInviteeForChangeInTx), then at most one target row (link, one-off, group slot or poll);
// 3. everything else.
//
// Server only. Client code imports the pure helpers from their own files: @/lib/booking/format (slot grouping),
// @/lib/booking/prefill (BK-15), @/lib/booking/redirect (BK-21), @/lib/booking/schemas (request schemas),
// @/lib/booking/rules (durations and windows) and @/lib/booking/types (every type here).
import "server-only";

export type * from "./types";

// Target resolution (section 8).
export { loadEventType, resolveTargetByCode, resolveTargetBySlugs } from "./target";

// Availability (section 8).
export {
  candidateHostIds,
  EXTERNAL_BUSY_TIMEOUT_MS,
  FRESHNESS_MAX_AGE_SECONDS,
  getAvailability,
  getBusyForUsers,
  MAX_RANGE_DAYS,
} from "./availability";
export { firstAvailableDate, groupSlotsByLocalDate, localDateRange, type SlotDays } from "./format";

// Booking creation and reservations (section 9).
export {
  completeReservation,
  createBooking,
  createReservation,
  getReservationStatus,
  isBlockedInvitee,
  resendReservationCode,
  RESERVATION_HOLD_MS,
  resultForInvitee,
  verificationPrompt,
  verifyReservationCode,
} from "./create";
export { hostLockKey, lockHostsInTx, lockInviteeForChangeInTx } from "./locks";

// Email verification (BK-17).
export {
  parseTrustedDeviceCookie,
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_MAX_AGE_SECONDS,
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_RESENDS_PER_HOUR,
} from "./verification";

// Troubleshoot view (SCOPE priority 4, SCH-21, BK-24).
export { candidateOut, redactDiagnostics, troubleshootAvailability, type TroubleshootActor } from "./troubleshoot";

// Public endpoints (BK-31) and abuse protection (BK-18).
export { publicBooking, publicSlots, slotsTarget, type PublicBookingOutcome, type SlotsResponse } from "./public";
export {
  assertBookingRateLimit,
  assertSlotsRateLimit,
  assertVerifyRateLimit,
  checkBookingBot,
  HONEYPOT_FIELD,
  issueBookingFormToken,
  MIN_FORM_MS,
  type BotCheckResult,
} from "./protect";
export { bookingRequestSchema, slotsQuerySchema, verifyRequestSchema, type BookingRequest, type SlotsQuery, type VerifyRequest } from "./schemas";

// Pure helpers (also importable from their own client-safe files).
export { parsePrefill, type BookingPrefill, type PrefillQuestion } from "./prefill";
export { buildRedirectUrl, isoInZone, type RedirectInput } from "./redirect";
export { allowedDurationsOf, dateRangeRuleOf, defaultDurationOf, resolveDuration } from "./rules";
export { locationsOf, MESSAGES, normalizePhone, resolveLocation, validateBookingInput, type ValidatedBooking } from "./validate";
