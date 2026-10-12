// OWNER: booking-core. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Booking contract (ARCHITECTURE sections 8 and 9): target resolution, the availability service (DB to slot engine),
// booking creation, reservations and the global lock order helpers.
// Foundation stub: everything throws AppError("not_configured") except the two lock helpers (real: they are the lock
// order steps used by lifecycle-core, links-sharing and polls-core) and the pure groupSlotsByLocalDate.
//
// Global lock order (normative): 1. lockHostsInTx (advisory locks per host, ascending user id); 2. row locks: the
// invitee being changed (lockInviteeForChangeInTx), then at most one target row (link, one-off, group slot or poll);
// 3. everything else.
import "server-only";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { advisoryXactLock } from "@/db/helpers";
import { eventTypeHostPools, eventTypeHosts, eventTypeQuestions, eventTypes, invitees } from "@/db/schema";
import type { LocationConfig, Tracking } from "@/db/types";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import type { BusyInterval, DateRangeRule, Slot, SlotEngineResult } from "@/lib/slots/types";
import { localDateOf } from "@/lib/time/luxon";

/** An event type row with the relations booking needs. */
export type EventTypeRow = typeof eventTypes.$inferSelect & {
  hosts: (typeof eventTypeHosts.$inferSelect)[];
  pools: (typeof eventTypeHostPools.$inferSelect)[];
  questions: (typeof eventTypeQuestions.$inferSelect)[];
};
export type InviteeRow = typeof invitees.$inferSelect;

export type BookingTarget = {
  kind: "event_type" | "single_use" | "one_off" | "shared";
  /** With hosts, pools, questions. */
  eventType: EventTypeRow;
  /** Single-use overrides (OO-02); one-off uses spots. */
  overrides?: {
    name?: string;
    durationMinutes?: number;
    durationOptions?: number[];
    locations?: LocationConfig[];
    scheduleId?: string;
    dateRange?: DateRangeRule;
    hideLocation?: boolean;
  };
  spots?: { start: Date; end: Date; overlappedExternalIds: string[] }[];
  linkId?: string;
  code?: string;
};

export type GetAvailabilityParams = {
  target: BookingTarget;
  start: Date;
  end: Date;
  durationMinutes?: number;
  now?: Date;
  troubleshoot?: boolean;
  /** Reschedule (SCH-24): solo/multi-host -> ignoreMeetingIds; group -> +1 seat on its slot. */
  ignoreInviteeId?: string;
  /** Completing or retrying one's own hold. */
  ignoreReservationId?: string;
  /** Ignore pending holds of this email for the same slot (retry payment). */
  reservationEmail?: string;
  /** One-off spots, poll bookings (SCH-09 enforcement by source). */
  ignoreLimits?: boolean;
  /** page: cache <= 180s; submit: cache <= 60s (CAL-10, SCH-20). */
  freshness?: "page" | "submit";
};

export type AvailabilityResult = SlotEngineResult & { hostsById: Record<string, { name: string; avatarUrl: string | null }> };

export type CreateBookingInput = {
  target: { kind: BookingTarget["kind"]; eventTypeId?: string; code?: string; handle?: string; eventSlug?: string };
  /** ISO UTC. */
  start: string;
  durationMinutes?: number;
  invitee: {
    name?: string;
    firstName?: string;
    lastName?: string;
    email: string;
    timezone: string;
    detectedTimezone?: string | null;
    timeFormat?: "12h" | "24h" | null;
    locale?: string;
    textReminderNumber?: string | null;
    marketingConsent?: boolean;
  };
  guests?: string[];
  locationAnswer?: { configId: string; value?: string | null };
  answers?: { questionId: string; value: string | string[] }[];
  tracking?: Tracking;
  routingFormSubmissionId?: string | null;
  /** Set by lifecycle reschedule. */
  reschedule?: { inviteeId: string; reason?: string | null } | null;
  actor?:
    | { type: "invitee" }
    | {
        type: "host";
        userId: string;
        overrideAvailability?: boolean;
        customize?: { name?: string; durationMinutes?: number; location?: LocationConfig };
      }
    | { type: "api"; userId: string };
  pollContext?: {
    pollId: string;
    optionId: string;
    bookedByUserId: string;
    participants: { participantId: string | null; name: string; email: string; timezone?: string | null }[];
  };
  /** Idempotency (BK-19). */
  clientRequestId?: string;
  verification?: { reservationId: string; code: string } | null;
};

export type CreateBookingErrorCode =
  | "slot_unavailable"
  | "validation"
  | "blocked"
  | "verification_required"
  | "payment_required"
  | "link_used"
  | "not_found"
  | "already_booked";

export type CreateBookingResult =
  | { ok: true; inviteeId: string; scheduledEventId: string; redirectUrl?: string }
  | {
      ok: false;
      code: CreateBookingErrorCode;
      message: string;
      fieldErrors?: Record<string, string[]>;
      reservationId?: string;
    };

export type BookingContext = { ip?: string; now?: Date };

const notConfigured = (what: string) => new AppError("not_configured", `${what} is not available yet.`);

export async function resolveTargetBySlugs(handle: string, eventSlug: string): Promise<BookingTarget | null> {
  void handle;
  void eventSlug;
  throw notConfigured("Booking");
}

/** Delegates to links.resolveBookingCode. */
export async function resolveTargetByCode(code: string): Promise<BookingTarget | null> {
  void code;
  throw notConfigured("Booking");
}

export async function getAvailability(params: GetAvailabilityParams): Promise<AvailabilityResult> {
  void params;
  throw notConfigured("Availability");
}

/**
 * External + meetings + reserved busy intervals for pickers and polls. Authz (GEN-08): every userId must be the actor
 * or a member of the actor's organization (else AppError forbidden); titles only for the actor's own intervals.
 */
export async function getBusyForUsers(
  actor: { userId: string; organizationId: string },
  userIds: string[],
  start: Date,
  end: Date,
): Promise<Record<string, BusyInterval[]>> {
  void actor;
  void userIds;
  void start;
  void end;
  throw notConfigured("Availability");
}

/** Groups slots by their local date in `zone`: { "2026-10-14": [{ start: ISO, remaining }] }. */
export function groupSlotsByLocalDate(slots: Slot[], zone: string): Record<string, { start: string; remaining: number }[]> {
  const out: Record<string, { start: string; remaining: number }[]> = {};
  for (const s of slots) {
    const day = localDateOf(s.start, zone);
    (out[day] ??= []).push({ start: new Date(s.start).toISOString(), remaining: s.inviteesRemaining });
  }
  return out;
}

export async function createBooking(input: CreateBookingInput, ctx: BookingContext): Promise<CreateBookingResult> {
  void input;
  void ctx;
  throw notConfigured("Booking");
}

export async function createReservation(
  input: CreateBookingInput & { kind: "payment" | "email_verification" },
  ctx: BookingContext,
): Promise<{ ok: true; reservationId: string; expiresAt: Date } | Extract<CreateBookingResult, { ok: false }>> {
  void input;
  void ctx;
  throw notConfigured("Booking");
}

export async function completeReservation(
  reservationId: string,
  extra: { paymentId?: string; verifiedEmail?: boolean; now?: Date },
): Promise<CreateBookingResult> {
  void reservationId;
  void extra;
  throw notConfigured("Booking");
}

/** Lock order step 1 (call inside a transaction): pg_advisory_xact_lock(hashtextextended('host:' || user_id, 0)) per host, ascending user id. */
export async function lockHostsInTx(tx: DbOrTx, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)].sort();
  await advisoryXactLock(tx, ...ids.map((id) => `host:${id}`));
}

/**
 * Lock order step 2: SELECT ... FOR UPDATE of the invitee being canceled or rescheduled. Throws AppError("not_found")
 * when it does not exist and AppError("conflict", details.reason "canceled" | "rescheduled") when it is no longer
 * active or was already rescheduled (callers map it, for example to "This event can no longer be rescheduled.").
 */
export async function lockInviteeForChangeInTx(tx: DbOrTx, inviteeId: string): Promise<InviteeRow> {
  // Capability ids come from URLs: a malformed id is "not found", never a uuid cast error (22P02).
  if (!isUuid(inviteeId)) throw new AppError("not_found", "This meeting could not be found.");
  const [row] = await tx.select().from(invitees).where(eq(invitees.id, inviteeId)).limit(1).for("update");
  if (!row) throw new AppError("not_found", "This meeting could not be found.");
  if (row.status !== "active" || row.rescheduled || row.newInviteeId) {
    const reason = row.rescheduled || row.newInviteeId ? "rescheduled" : "canceled";
    throw new AppError("conflict", "This event was already canceled or rescheduled.", { details: { reason } });
  }
  return row;
}

