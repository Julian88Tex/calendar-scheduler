// OWNER: lifecycle-core.
//
// Meeting lifecycle services (ARCHITECTURE sections 9 and 25; SPEC CR-01..CR-21, NT-01..NT-06, CAL-11, CAL-12,
// CAL-14, SCH-23): cancel, reschedule, in-place move, request reschedule, no-shows, notes, invitee limit, remove,
// block, host reassignment, provisioning retry and external calendar changes. Every mutation takes the meeting's host
// locks first (booking.lockHostsInTx), then booking.lockInviteeForChangeInTx, then the meeting row, publishes a domain
// event in the same transaction and runs its side effects (calendar writes, conferences, emails) as jobs right after
// the response. Services authorize "user" and "api" actors themselves (meetingAccess); "invitee" actors hold the
// capability URL; "system" actors are jobs and connected calendar changes.
//
// Implementation files: cancel.ts, reschedule.ts, host-actions.ts, external.ts (services); provision.ts (calendar
// event, Meet, CAL-12 fallback); notify.ts and emails/ (booking emails); policy.ts (client-safe invitee change rules,
// SCH-23); queries.ts (read model of the cancel and reschedule pages); subscriber-handlers.ts and job-handlers.ts.
//
// Additive exports (contract churn rule): getInviteeChangeContext, the policy helpers, the actor and change types.
import "server-only";
import type { CreateBookingInput, CreateBookingResult, InviteeRow } from "@/lib/booking";
import type { DbOrTx } from "@/db";
import { cancelInvitee as cancelInviteeImpl, cancelScheduledEvent as cancelScheduledEventImpl, removeInvitee as removeInviteeImpl } from "./cancel";
import { resolveActiveInviteeChain as resolveChain } from "./chain";
import { applyExternalCalendarChange as applyExternal } from "./external";
import * as host from "./host-actions";
import { moveScheduledEvent as moveImpl, requestReschedule as requestRescheduleImpl, rescheduleInvitee as rescheduleImpl } from "./reschedule";
import type { ExternalCalendarChange, LifecycleActor } from "./types";

export type { ExternalCalendarChange, LifecycleActor, LifecycleInviteeMeta, LifecycleMeetingMeta, CancelKind } from "./types";
export { cancelReasonProblem, inviteeCancelBlock, inviteeRescheduleBlock, isRebookable, type ChangeBlock, type ChangeBlockReason } from "./policy";
export { getInviteeChangeContext, type InviteeChangeContext } from "./queries";

/** Cancels one invitee (the meeting too when it was the last active invitee). Invitee reason required per CR-05. */
export async function cancelInvitee(p: {
  inviteeId: string;
  actor: LifecycleActor;
  reason?: string | null;
  /** Default true: send the cancellation emails. */
  notify?: boolean;
}): Promise<{ inviteeId: string; scheduledEventId: string; meetingCanceled: boolean }> {
  return cancelInviteeImpl(p);
}

/** Host cancel of the whole meeting (all invitees of a group slot, CR-06). */
export async function cancelScheduledEvent(p: {
  scheduledEventId: string;
  actor: LifecycleActor;
  reason?: string | null;
  notify?: boolean;
}): Promise<{ scheduledEventId: string; canceledInviteeIds: string[] }> {
  return cancelScheduledEventImpl(p);
}

/**
 * Reschedules an invitee to a new start through booking-core createBooking (reschedule variant, CR-03, CR-04, CR-09).
 * Refuses one-off and poll meetings and event types that are off or deleted.
 */
export async function rescheduleInvitee(p: {
  inviteeId: string;
  /** ISO UTC start of the new time. */
  start: string;
  durationMinutes?: number;
  reason?: string | null;
  actor: LifecycleActor;
  /** Updated details from the reschedule form (zone, time format, answers, guests, location choice). */
  invitee?: Partial<CreateBookingInput["invitee"]>;
  guests?: string[];
  locationAnswer?: CreateBookingInput["locationAnswer"];
  answers?: CreateBookingInput["answers"];
  /** Host reschedules: override available times (single host, OO-14) or pick a round robin host (CR-07, CR-09). */
  host?: { overrideAvailability?: boolean; hostUserId?: string | null; keepHosts?: boolean };
  clientRequestId?: string;
}, ctx: { ip?: string; now?: Date } = {}): Promise<CreateBookingResult> {
  return rescheduleImpl(p, ctx);
}

/** In-place move of a meeting (same row, SEQUENCE + 1, calendar and conference update, update emails; poll rebook MP-21). */
export async function moveScheduledEvent(p: {
  scheduledEventId: string;
  start: Date;
  end: Date;
  actor: LifecycleActor;
}): Promise<void> {
  return moveImpl(p);
}

/** CR-08 "Share new times to meet": cancels, emails the invitee a rebook link, optional 1/3/7 day reminder job. */
export async function requestReschedule(p: {
  inviteeId: string;
  actor: LifecycleActor;
  message?: string | null;
  reminderDays?: 1 | 3 | 7 | null;
}): Promise<void> {
  return requestRescheduleImpl(p);
}

/** CR-11: marks an invitee as a no-show (after the meeting's start). */
export async function markNoShow(p: { inviteeId: string; actor: LifecycleActor }): Promise<{ noShowId: string }> {
  return host.markNoShow(p);
}

export async function unmarkNoShow(p: { inviteeId: string; actor: LifecycleActor }): Promise<void> {
  return host.unmarkNoShow(p);
}

/** CR-14: host-only meeting notes (sanitized HTML, up to 10,000 characters). */
export async function updateMeetingNotes(p: { scheduledEventId: string; html: string; actor: LifecycleActor }): Promise<void> {
  return host.updateMeetingNotes(p);
}

/** CR-20: invitee limit of one booked group slot (at least the active invitee count, at most 9,999). */
export async function setInviteeLimit(p: { scheduledEventId: string; limit: number; actor: LifecycleActor }): Promise<void> {
  return host.setInviteeLimit(p);
}

/** CR-10 "Remove invitee": host cancel of one group invitee. */
export async function removeInvitee(p: { inviteeId: string; actor: LifecycleActor; reason?: string | null }): Promise<void> {
  return removeInviteeImpl(p);
}

/** CR-12: blocks an email (or domain) for a host and cancels their upcoming non-group meetings with that host. */
export async function blockInvitee(p: {
  hostUserId: string;
  actor: LifecycleActor;
  email?: string | null;
  domain?: string | null;
  reason?: string | null;
  sourceInviteeId?: string | null;
}): Promise<{ blockedId: string; canceledInviteeIds: string[] }> {
  return host.blockInvitee(p);
}

export async function unblockInvitee(p: { hostUserId: string; blockedId: string; actor: LifecycleActor }): Promise<void> {
  return host.unblockInvitee(p);
}

/** CR-19: moves a round robin meeting to another pool host (docs/SCOPE.md: no round robin event types in this build). */
export async function reassignHost(p: {
  scheduledEventId: string;
  fromUserId: string;
  toUserId: string;
  actor: LifecycleActor;
  notify?: boolean;
}): Promise<void> {
  return host.reassignHost(p);
}

/** Re-runs provisioning (conference and calendar) of a meeting ("Retry", VID-12). */
export async function retryProvisioning(p: { scheduledEventId: string; actor: LifecycleActor }): Promise<void> {
  return host.retryProvisioning(p);
}

/** CAL-14 / CR-17: a provider event of a booked meeting was deleted, declined or moved. */
export async function applyExternalCalendarChange(p: {
  linkedEventId: string;
  change: ExternalCalendarChange;
}): Promise<void> {
  return applyExternal(p);
}

/**
 * Follows invitees.new_invitee_id from a (possibly rescheduled) invitee to the current one of its chain (CR-04: links
 * of old invitees open the active one). Returns null when the invitee does not exist (or the id is not a uuid). Cycles are cut after 50 hops.
 */
export async function resolveActiveInviteeChain(inviteeId: string, db?: DbOrTx): Promise<InviteeRow | null> {
  return resolveChain(inviteeId, db);
}
