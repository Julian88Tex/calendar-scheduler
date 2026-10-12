// Slot engine public API (ARCHITECTURE section 7, SPEC SCH-01 to SCH-24). Pure: no I/O, no clock reads (query.now),
// no implicit randomness (selectHosts takes `random`). Client and server safe.
//
//   computeSlots({ rules, hosts, query })  available slots (+ troubleshoot diagnostics) and the booking window end
//   selectHosts({ rules, hosts, slot })     host assignment at booking time (also reservation provisional hosts)
//   reasonLabel / reasonHint               troubleshoot chips and fix hints (SPEC Appendix B)
//   bookingWindow                           the window alone (booking-core short circuit, BK-31 step 0)
//   busy helpers                            interval math for the availability service (section 7.4)
export type * from "./types";

export { computeSlots } from "./engine";
export { selectHosts, choosePoolHost, type AssignmentReason, type PoolAssignment, type SelectHostsInput } from "./assign";
export { REASON_CODES, REASON_PRIORITY, isReasonCode, reasonHint, reasonLabel, sortReasons } from "./reasons";
export { bookingWindow, inWindow, windowReasons, MAX_WINDOW_DAYS, type BookingWindow } from "./window";
export {
  BusyIndex,
  expandAllDay,
  intersectAll,
  intersectIntervals,
  isNonEmptyInterval,
  matchesFreeBusyException,
  mergeIntervals,
  normalizeBusy,
  splitAtLocalMidnights,
  subtractIntervals,
  unionIntervals,
  type FreeBusyException,
} from "./busy";
export { countByPeriod, limitCountSpan, periodKeysOf, reachedPeriods, type Period, type PeriodCounts, type PeriodKeys } from "./limits";
export { dateIntervals, hoursForDate, sanitizeRanges, buildHostBlocks, type DateHours, type HostBlocks } from "./schedule";
export { combineBlocks, type CombinedBlocks } from "./blocks";
export { decidePooling, equalDistributionHidden, groupHosts, EQUAL_DISTRIBUTION_GAP, REQUIRED_KEY } from "./pooling";
export { isValidTimeZone, zoneClock, type ZoneClock } from "./zone";
