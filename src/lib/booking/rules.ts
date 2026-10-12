// Event type to slot engine rules (ARCHITECTURE section 8), durations (SCH-18) and the booking window short circuit
// (BK-31 step 0). Pure: no I/O.
import type { BookingWindow } from "@/lib/slots";
import type { DateRangeRule, EventTypeRules, Interval, MeetingStart } from "@/lib/slots/types";
import { isIsoDate } from "@/lib/slots/zone";
import type { BookingTarget, EventTypeRow } from "./types";

/** The event type's date range rule (SCH-02 to SCH-05), or the single-use override. */
export function dateRangeRuleOf(et: EventTypeRow, overrides?: BookingTarget["overrides"]): DateRangeRule {
  if (overrides?.dateRange) return overrides.dateRange;
  if (et.dateRangeType === "unlimited") return { type: "unlimited" };
  if (et.dateRangeType === "fixed") {
    // A fixed range with missing dates yields no slots (the engine treats invalid dates as an empty window).
    return { type: "fixed", startDate: et.dateRangeStart ?? "", endDate: et.dateRangeEnd ?? "" };
  }
  return { type: "rolling", days: et.dateRangeDays, mode: et.dateRangeMode };
}

/** True when the date range needs every future override and holiday (SCH-03 "days with availability"). */
export function needsWholeFuture(range: DateRangeRule): boolean {
  return range.type === "rolling" && range.mode === "available_days";
}

/** Default duration of a target (single-use override first). */
export function defaultDurationOf(target: Pick<BookingTarget, "eventType" | "overrides">): number {
  return target.overrides?.durationMinutes ?? target.eventType.durationMinutes;
}

/** Durations the invitee may choose (SCH-18), default first. */
export function allowedDurationsOf(target: Pick<BookingTarget, "eventType" | "overrides">): number[] {
  const et = target.eventType;
  const def = defaultDurationOf(target);
  const options = target.overrides?.durationOptions?.length
    ? target.overrides.durationOptions
    : target.overrides?.durationMinutes
      ? [target.overrides.durationMinutes]
      : et.durationOptions?.length
        ? et.durationOptions
        : [et.durationMinutes];
  const out = [def, ...options.filter((d) => d !== def)];
  return out.filter((d, i) => Number.isInteger(d) && d >= 1 && d <= 720 && out.indexOf(d) === i);
}

/** The duration to use: the requested one when allowed (adhoc types accept any 1 to 720), else the default. */
export function resolveDuration(target: Pick<BookingTarget, "eventType" | "overrides">, requested?: number | null): number | null {
  if (requested === undefined || requested === null) return defaultDurationOf(target);
  if (!Number.isInteger(requested) || requested < 1 || requested > 720) return null;
  if (target.eventType.type === "adhoc") return requested;
  return allowedDurationsOf(target).includes(requested) ? requested : null;
}

export type RulesInput = {
  target: BookingTarget;
  durationMinutes: number;
  rangeZone: string;
  weekStart: 0 | 1;
  eventTypeMeetingStarts: MeetingStart[];
  groupSlots: EventTypeRules["groupSlots"];
  spots?: Interval[] | null;
  /** One-off and poll meetings snapshot 0/0 buffers (SCH-07). */
  zeroBuffers?: boolean;
  /** Host override bookings (OO-14) and polls: no notice and no date range (past starts stay invalid). */
  ignoreNoticeAndRange?: boolean;
};

/** Slot engine rules of a booking target. */
export function buildRules(p: RulesInput): EventTypeRules {
  const et = p.target.eventType;
  const isGroup = et.kind === "group";
  return {
    eventTypeId: et.id,
    durationMinutes: p.durationMinutes,
    incrementMinutes: et.slotIncrementMinutes,
    alignment: et.slotAlignment,
    bufferBeforeMinutes: p.zeroBuffers ? 0 : et.bufferBeforeMinutes,
    bufferAfterMinutes: p.zeroBuffers ? 0 : et.bufferAfterMinutes,
    minimumNoticeMinutes: p.ignoreNoticeAndRange ? 0 : et.minimumNoticeMinutes,
    dateRange: p.ignoreNoticeAndRange ? { type: "unlimited" } : dateRangeRuleOf(et, p.target.overrides),
    rangeZone: p.rangeZone,
    weekStart: p.weekStart,
    limits: { day: et.limitPerDay, week: et.limitPerWeek, month: et.limitPerMonth },
    eventTypeMeetingStarts: p.eventTypeMeetingStarts,
    kind: isGroup ? "group" : "solo",
    seats: isGroup ? Math.max(1, et.maxInvitees) : 1,
    groupSlots: p.groupSlots,
    pooling: et.poolingType ?? null,
    pools: et.pools
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((pool) => ({ id: pool.id, distribution: pool.distribution })),
    freeBusyExceptions: et.freeBusyExceptions ?? [],
    spots: p.spots ?? null,
    organizerUserId: et.organizerUserId ?? et.ownerUserId ?? null,
  };
}

/**
 * BK-31 step 0: true when no start in [rangeStart, rangeEnd) can lie inside the booking window, so the request is
 * answered with no slots without loading busy times or calling calendar providers.
 */
export function rangeOutsideWindow(w: BookingWindow, rangeStart: number, rangeEnd: number): boolean {
  const lower = Math.max(w.now, w.earliest, w.start ?? -Infinity);
  if (rangeEnd <= lower) return true;
  if (w.end !== null && rangeStart >= w.end) return true;
  return false;
}

/** True when a fixed range rule has usable dates. */
export function fixedRangeValid(range: DateRangeRule): boolean {
  return range.type !== "fixed" || (isIsoDate(range.startDate) && isIsoDate(range.endDate) && range.endDate >= range.startDate);
}
