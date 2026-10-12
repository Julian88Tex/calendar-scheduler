// Booking contract types (ARCHITECTURE sections 8 and 9). Type-only module: safe to import from anywhere, including
// client code (booking-pages renders these shapes). The contract file src/lib/booking/index.ts re-exports everything
// here; the original foundation types keep their exact shape, later additions are marked "additive".
import type { eventTypeHostPools, eventTypeHosts, eventTypeQuestions, eventTypes, invitees } from "@/db/schema";
import type { LocationConfig, Tracking } from "@/db/types";
import type {
  BusyInterval,
  CandidateDiagnostic,
  DateRangeRule,
  ReasonCode,
  Slot,
  SlotEngineResult,
} from "@/lib/slots/types";

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
  /** Additive: state of the single-use link or one-off (BK-23); anything but "active" offers no slots. */
  linkStatus?: "active" | "used" | "expired";
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
  /**
   * Additive, troubleshoot only: also list each day's starts outside working hours (flagged outsideHours), for the
   * Troubleshoot view (SPEC SCOPE priority 4).
   */
  diagnoseOutsideHours?: boolean;
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

export type BookingContext = {
  ip?: string;
  now?: Date;
  /**
   * Additive: "Remember this device" tokens read from the embed-safe cookie (BK-17). A valid token for the invitee's
   * email skips email verification.
   */
  trustedDeviceTokens?: string[];
};

// ---------------------------------------------------------------------------------------------------------------
// Additive: reservation status (embed payment polling, BK-31) and email verification (BK-17)

export type ReservationStatus = {
  status: "pending" | "completed" | "expired" | "canceled";
  kind: "payment" | "email_verification";
  /** Set once the reservation became a booking. */
  inviteeId: string | null;
  expiresAt: string;
};

export type VerifyCodeResult =
  | (Extract<CreateBookingResult, { ok: true }> & { trustedDevice?: { cookieName: string; value: string; maxAgeSeconds: number } })
  | {
      ok: false;
      code: "invalid_code" | "expired" | "too_many_attempts" | "not_found" | "slot_unavailable" | "already_booked" | "link_used";
      message: string;
    };

// ---------------------------------------------------------------------------------------------------------------
// Additive: the Troubleshoot view (availability module, SCOPE priority 4)

export type TroubleshootParams = {
  /** The host to diagnose (default: the actor). Other hosts must be in the actor's organization; titles are stripped. */
  hostUserId?: string;
  /** One event type, or null/undefined for every event type the host hosts. */
  eventTypeId?: string | null;
  /** Range of candidate starts (at most 62 days; usually one local day). */
  start: Date;
  end: Date;
  /** Duration to diagnose (default: the event type's default duration). */
  durationMinutes?: number;
  now?: Date;
};

/** One blocker of a candidate with the copy the Troubleshoot view shows ("Conflicts with 'Team sync'"). */
export type TroubleshootBlocker = {
  code: ReasonCode;
  source: BusyInterval["source"];
  /** The blocking interval (meetings: the buffered range). */
  start: number;
  end: number;
  /** Meetings: the meeting itself without buffers. */
  core: { start: number; end: number } | null;
  /** Calendar event title or meeting name; null for other people's events (GEN-08) and untitled events. */
  title: string | null;
  calendarId: string | null;
  meetingId: string | null;
  eventTypeId: string | null;
  bufferSide: "before" | "after" | null;
};

export type TroubleshootCandidate = {
  start: number;
  end: number;
  available: boolean;
  reasons: ReasonCode[];
  /** "outside_hours" | the primary reason code, for the status chip. */
  status: "available" | "outside_hours" | ReasonCode;
  outsideHours: boolean;
  /** Event type limit periods that are full (DAILY_MAX, WEEKLY_MAX, MONTHLY_MAX). */
  limitPeriods: ("day" | "week" | "month")[];
  /** Host-level meeting limit periods that are full (MEETING_LIMIT). */
  hostLimitPeriods: ("day" | "week" | "month")[];
  blockers: TroubleshootBlocker[];
};

export type TroubleshootEventType = {
  id: string;
  name: string;
  slug: string;
  color: string;
  durationMinutes: number;
  active: boolean;
  secret: boolean;
  scheduleId: string | null;
  scheduleName: string | null;
  /** Zone of the event type's limits and date range (the host's schedule zone for solo types). */
  timeZone: string;
  settings: {
    incrementMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    minimumNoticeMinutes: number;
    dateRange: DateRangeRule;
    limits: { day: number | null; week: number | null; month: number | null };
  };
};

export type TroubleshootEntry = {
  eventType: TroubleshootEventType;
  /** Booking window end (epoch ms; null = no end). */
  windowEnd: number | null;
  slots: Slot[];
  candidates: TroubleshootCandidate[];
};

export type TroubleshootResult = {
  host: { id: string; name: string; timeZone: string; weekStart: 0 | 1 };
  /** Host-level meeting limits across every event type (Availability > Advanced). */
  hostLimits: { day: number | null; week: number | null; month: number | null };
  calendar: { status: "ok" | "nocal"; stale: boolean };
  /** Every busy interval of the host overlapping the range (calendar events, meetings, holds), titles per GEN-08. */
  busy: TroubleshootBlocker[];
  entries: TroubleshootEntry[];
};

export type { CandidateDiagnostic };
