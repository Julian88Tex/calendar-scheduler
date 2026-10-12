// OWNER: lifecycle-core. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Meeting lifecycle services (ARCHITECTURE sections 9 and 25; SPEC CR-01..CR-21): cancel, reschedule, in-place move,
// request reschedule, no-shows, notes, invitee limit, remove, block, host reassignment, provisioning retry and
// external calendar changes. Every mutation takes the meeting's host locks first (booking.lockHostsInTx), then
// booking.lockInviteeForChangeInTx, publishes a domain event in the same transaction and runs side effects as jobs.
// Services authorize "user" and "api" actors themselves (meetingAccess); "invitee" actors hold the capability URL;
// "system" actors are jobs.
// Foundation stub: everything throws AppError("not_configured") except resolveActiveInviteeChain (real).
import "server-only";
import { eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { invitees } from "@/db/schema";
import type { ActorCtx } from "@/lib/authz";
import type { CreateBookingInput, CreateBookingResult, InviteeRow } from "@/lib/booking";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";

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

const notConfigured = () => new AppError("not_configured", "This action is not available yet.");

/** Cancels one invitee (the meeting too when it was the last active invitee). Invitee reason required per CR-05. */
export async function cancelInvitee(p: {
  inviteeId: string;
  actor: LifecycleActor;
  reason?: string | null;
  /** Default true: send the cancellation emails. */
  notify?: boolean;
}): Promise<{ inviteeId: string; scheduledEventId: string; meetingCanceled: boolean }> {
  void p;
  throw notConfigured();
}

/** Host cancel of the whole meeting (all invitees of a group slot, CR-06). */
export async function cancelScheduledEvent(p: {
  scheduledEventId: string;
  actor: LifecycleActor;
  reason?: string | null;
  notify?: boolean;
}): Promise<{ scheduledEventId: string; canceledInviteeIds: string[] }> {
  void p;
  throw notConfigured();
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
  void p;
  void ctx;
  throw notConfigured();
}

/** In-place move of a meeting (same row, SEQUENCE + 1, calendar and conference update, update emails; poll rebook MP-21). */
export async function moveScheduledEvent(p: {
  scheduledEventId: string;
  start: Date;
  end: Date;
  actor: LifecycleActor;
}): Promise<void> {
  void p;
  throw notConfigured();
}

/** CR-08 "Share new times to meet": cancels, emails the invitee a rebook link, optional 1/3/7 day reminder job. */
export async function requestReschedule(p: {
  inviteeId: string;
  actor: LifecycleActor;
  message?: string | null;
  reminderDays?: 1 | 3 | 7 | null;
}): Promise<void> {
  void p;
  throw notConfigured();
}

/** CR-11: marks an invitee as a no-show (after the meeting's start). */
export async function markNoShow(p: { inviteeId: string; actor: LifecycleActor }): Promise<{ noShowId: string }> {
  void p;
  throw notConfigured();
}

export async function unmarkNoShow(p: { inviteeId: string; actor: LifecycleActor }): Promise<void> {
  void p;
  throw notConfigured();
}

/** CR-14: host-only meeting notes (sanitized HTML, up to 10,000 characters). */
export async function updateMeetingNotes(p: { scheduledEventId: string; html: string; actor: LifecycleActor }): Promise<void> {
  void p;
  throw notConfigured();
}

/** CR-20: invitee limit of one booked group slot (at least the active invitee count, at most 9,999). */
export async function setInviteeLimit(p: { scheduledEventId: string; limit: number; actor: LifecycleActor }): Promise<void> {
  void p;
  throw notConfigured();
}

/** CR-10 "Remove invitee": host cancel of one group invitee. */
export async function removeInvitee(p: { inviteeId: string; actor: LifecycleActor; reason?: string | null }): Promise<void> {
  void p;
  throw notConfigured();
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
  void p;
  throw notConfigured();
}

export async function unblockInvitee(p: { hostUserId: string; blockedId: string; actor: LifecycleActor }): Promise<void> {
  void p;
  throw notConfigured();
}

/** CR-19: moves a round robin meeting to another pool host. */
export async function reassignHost(p: {
  scheduledEventId: string;
  fromUserId: string;
  toUserId: string;
  actor: LifecycleActor;
  notify?: boolean;
}): Promise<void> {
  void p;
  throw notConfigured();
}

/** Re-runs provisioning (conference and calendar) of a meeting ("Retry", VID-12). */
export async function retryProvisioning(p: { scheduledEventId: string; actor: LifecycleActor }): Promise<void> {
  void p;
  throw notConfigured();
}

/** CAL-14 / CR-17: a provider event of a booked meeting was deleted, declined or moved. */
export async function applyExternalCalendarChange(p: {
  linkedEventId: string;
  change: ExternalCalendarChange;
}): Promise<void> {
  void p;
  throw notConfigured();
}

/**
 * Follows invitees.new_invitee_id from a (possibly rescheduled) invitee to the current one of its chain (CR-04: links
 * of old invitees open the active one). Returns null when the invitee does not exist (or the id is not a uuid). Cycles are cut after 50 hops.
 */
export async function resolveActiveInviteeChain(inviteeId: string, db?: DbOrTx): Promise<InviteeRow | null> {
  if (!isUuid(inviteeId)) return null; // capability ids come from URLs; malformed ids are unknown, not a 22P02 error
  const d = db ?? (await getDb());
  let [row] = await d.select().from(invitees).where(eq(invitees.id, inviteeId)).limit(1);
  for (let hops = 0; row?.newInviteeId && hops < 50; hops++) {
    const [next] = await d.select().from(invitees).where(eq(invitees.id, row.newInviteeId)).limit(1);
    if (!next) break;
    row = next;
  }
  return row ?? null;
}
