// Shared types of the lifecycle module (SPEC CR-*, NT-*, CAL-11, CAL-12). Type-only plus small pure helpers, safe to
// import from client code (lifecycle-ui reads the metadata shapes and the actor type).
//
// Module state lives in the `lifecycle` key of scheduled_events.metadata and invitees.metadata (docs/schema-requests
// README: module data in the main tables' metadata under the module key), never in other modules' keys.
import type { ActorCtx } from "@/lib/authz";

export type LifecycleActor =
  /** The invitee through a capability URL (/cancellations/{id}, /reschedulings/{id}). */
  | { type: "invitee"; name?: string | null }
  /** A signed-in host, event type editor or org admin (authorized inside the service). */
  | { type: "user"; ctx: ActorCtx }
  /** A job or a connected calendar change. */
  | { type: "system"; name?: string | null }
  /** A personal access token (api-v1). */
  | { type: "api"; ctx: ActorCtx; tokenId?: string };

export type ExternalCalendarChange =
  | { type: "deleted" }
  | { type: "declined" }
  | { type: "moved"; start: Date; end: Date };

/** What the calendar write of one host last produced (skips identical rewrites; CAL-11 idempotency). */
export type HostCalendarState = {
  linkedEventId: string | null;
  fingerprint: string;
  status: "synced" | "pending" | "failed" | "skipped_no_calendar";
  at: string;
};

/** scheduled_events.metadata.lifecycle */
export type LifecycleMeetingMeta = {
  provision?: {
    /** Failed organizer calendar writes since the last success (CAL-12 fallback counts these). */
    attempts?: number;
    firstFailureAt?: string | null;
    lastError?: string | null;
    /** CAL-12: the moment the meeting switched permanently to email confirmations. */
    fallbackAt?: string | null;
    /** Pending Meet link re-reads (VID-12). */
    conferenceChecks?: number;
    conferenceFailureNotifiedAt?: string | null;
    /** The first provisioning run (notifications wait at most a minute for a Meet link). */
    startedAt?: string | null;
  };
  calendar?: Record<string, HostCalendarState>;
  /** CR-17: the meeting was created by a move in the connected calendar (no provider write needed). */
  origin?: "calendar_sync" | null;
  /** The whole meeting was canceled in one action (one host email instead of one per invitee). */
  canceledAsWhole?: boolean;
  /** In-place moves (MP-21): the time before the last move. */
  lastMove?: { fromStart: string; fromEnd: string; at: string; sequence: number } | null;
};

export type CancelKind = "request_reschedule" | "blocked" | "calendar" | "account" | "removed";

/** invitees.metadata.lifecycle */
export type LifecycleInviteeMeta = {
  cancelKind?: CancelKind | null;
  /** false: the cancellation was done without notifications. */
  notify?: boolean;
  /** CR-08 "Share new times to meet". */
  requestReschedule?: {
    requestedAt: string;
    message: string | null;
    reminderDays: 1 | 3 | 7 | null;
    byUserId: string | null;
    /** Set once the invitee booked again (the reminder is canceled). */
    rebookedInviteeId?: string | null;
  } | null;
};

export function meetingMetaOf(metadata: Record<string, unknown> | null | undefined): LifecycleMeetingMeta {
  const v = metadata?.lifecycle;
  return v && typeof v === "object" ? (v as LifecycleMeetingMeta) : {};
}

export function inviteeMetaOf(metadata: Record<string, unknown> | null | undefined): LifecycleInviteeMeta {
  const v = metadata?.lifecycle;
  return v && typeof v === "object" ? (v as LifecycleInviteeMeta) : {};
}

/** A new metadata object with the lifecycle key merged (other modules' keys untouched). */
export function withLifecycleMeta<T extends object>(metadata: Record<string, unknown> | null | undefined, patch: Partial<T>): Record<string, unknown> {
  const base = metadata ?? {};
  const current = base.lifecycle && typeof base.lifecycle === "object" ? (base.lifecycle as Record<string, unknown>) : {};
  return { ...base, lifecycle: { ...current, ...patch } };
}

/** Days the request reschedule link stays usable (CR-08, our choice). */
export const REQUEST_RESCHEDULE_VALID_DAYS = 30;
/** Job types of this module (ARCHITECTURE 12.2). */
export const JOB_TYPES = {
  provisionRetry: "lifecycle.provision_retry",
  requestRescheduleReminder: "lifecycle.request_reschedule_reminder",
  cancelUserMeetings: "lifecycle.cancel_user_meetings",
  meetingMoved: "lifecycle.meeting_moved",
} as const;
