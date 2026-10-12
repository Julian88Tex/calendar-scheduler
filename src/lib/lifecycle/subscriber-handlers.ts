// Domain event subscribers of the lifecycle module (ARCHITECTURE 12.1; key "lifecycle"): each runs as its own job
// (`event:{type}:lifecycle`) right after the change (runJobsAfterResponse), else on the next cron tick. Handlers re-read
// the state and are idempotent (identical calendar writes are skipped, emails carry idempotency keys), so a retried
// job is safe.
//
//   booking.created      provision (conference, calendar event) then notify (NT-01, NT-02)
//   booking.canceled     calendar delete (or the group slot update), standalone conference delete, cancellation emails
//   booking.rescheduled  repoint the provider events to the new meeting and move them (or, after a change in the
//                        connected calendar, keep them as they are), group slot updates, reschedule emails
//   meeting.updated      invitee limit, location and buffer changes reach the provider events
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import type { DB } from "@/db";
import { calendarLinkedEvents, invitees, scheduledEventHosts, scheduledEvents, users } from "@/db/schema";
import { deleteLinkedEvent, repointLinkedEvents } from "@/lib/calendars";
import { syncBufferEvents } from "@/lib/calendars/linked-events";
import { conferenceMode, deleteConference, updateConference } from "@/lib/conferencing";
import type { DomainEvent } from "@/lib/events";
import type { JobContext } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { notifyCanceled, notifyMeeting, sendConferenceFailure, sendFallbackNotice } from "./notify";
import { provisionMeeting, type ProvisionOptions, type ProvisionOutcome } from "./provision";
import { inviteeMetaOf, meetingMetaOf } from "./types";

/** After a provisioning run: the fallback notice, the conference failure email, and the notifications when ready. */
export async function afterProvision(db: DB, scheduledEventId: string, out: ProvisionOutcome, notify: { inviteeIds?: string[] } = {}): Promise<void> {
  if (!out.active) return;
  if (out.fellBack) await sendFallbackNotice(db, scheduledEventId);
  if (out.conference === "failed") await sendConferenceFailure(db, scheduledEventId);
  if (out.ready) await notifyMeeting(db, scheduledEventId, notify);
}

export async function provisionAndNotify(db: DB, scheduledEventId: string, opts: ProvisionOptions = {}, notify: { inviteeIds?: string[] } = {}): Promise<ProvisionOutcome> {
  const out = await provisionMeeting(db, scheduledEventId, opts);
  await afterProvision(db, scheduledEventId, out, notify);
  return out;
}

/** The live provider events of a meeting (every host, purpose meeting). */
async function meetingLinkedRows(db: DB, scheduledEventId: string) {
  return db
    .select({ id: calendarLinkedEvents.id, userId: calendarLinkedEvents.userId })
    .from(calendarLinkedEvents)
    .where(and(eq(calendarLinkedEvents.scheduledEventId, scheduledEventId), eq(calendarLinkedEvents.purpose, "meeting"), ne(calendarLinkedEvents.status, "deleted")));
}

/** Deletes a canceled meeting's provider events (and buffer events) and its standalone conference (CR-16, VID-14). */
async function removeProviderSide(db: DB, scheduledEventId: string, opts: { notifyAttendees: boolean; comment?: string | null }): Promise<void> {
  const [m] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).limit(1);
  if (!m) return;
  const invitation = m.settingsSnapshot?.notificationMode === "calendar_invitation";
  for (const row of await meetingLinkedRows(db, scheduledEventId)) {
    // Calendar invitation mode: the organizer's provider sends the cancellation to the attendees.
    await deleteLinkedEvent({
      linkedEventId: row.id,
      notifyAttendees: opts.notifyAttendees && invitation && row.userId === m.organizerUserId,
      ...(opts.comment ? { comment: opts.comment } : {}),
    });
  }
  const loc = m.location;
  if (loc?.kind && conferenceMode(loc.kind) === "standalone" && loc.status === "pushed") {
    try {
      await deleteConference({ location: loc, organizerUserId: m.organizerUserId });
    } catch (e) {
      log.warn("lifecycle.conference_delete_failed", { scheduledEventId, error: e });
    }
  }
}

export async function onBookingCreated(event: DomainEvent<"booking.created">, ctx: JobContext): Promise<void> {
  await provisionAndNotify(ctx.db, event.payload.scheduledEventId);
}

export async function onBookingCanceled(event: DomainEvent<"booking.canceled">, ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const { scheduledEventId, inviteeId, meetingCanceled, reason } = event.payload;
  const [m] = await db.select({ status: scheduledEvents.status }).from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).limit(1);
  if (!m) return;
  const [inv] = await db.select({ metadata: invitees.metadata }).from(invitees).where(eq(invitees.id, inviteeId)).limit(1);
  const notify = inviteeMetaOf(inv?.metadata).notify !== false;
  if (meetingCanceled || m.status === "canceled") {
    await removeProviderSide(db, scheduledEventId, { notifyAttendees: notify, comment: reason });
  } else {
    // A group seat or a poll invitee left: the shared provider event lists the remaining invitees.
    await provisionMeeting(db, scheduledEventId);
  }
  await notifyCanceled(db, { scheduledEventId, inviteeId, meetingCanceled: meetingCanceled || m.status === "canceled" });
}

export async function onBookingRescheduled(event: DomainEvent<"booking.rescheduled">, ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const { oldScheduledEventId, newScheduledEventId, newInviteeId } = event.payload;
  const [oldM] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, oldScheduledEventId)).limit(1);
  const [newM] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, newScheduledEventId)).limit(1);
  if (!newM) return;
  const group = Boolean(oldM?.isGroup || newM.isGroup);
  let existingLinkedEventId: string | null = null;
  if (oldM && oldM.id !== newM.id) {
    if (!group && oldM.status === "canceled") {
      // CR-04: the provider event moves with the meeting (repointed, then updated below), never recreated.
      await repointLinkedEvents({ fromScheduledEventId: oldM.id, toScheduledEventId: newM.id });
    } else if (oldM.isGroup) {
      // The former group slot: updated (one invitee fewer) or deleted with its last invitee.
      if (oldM.status === "active") await provisionMeeting(db, oldM.id);
      else await removeProviderSide(db, oldM.id, { notifyAttendees: false });
    }
  }
  const rows = await meetingLinkedRows(db, newM.id);
  existingLinkedEventId = rows.find((r) => r.userId === newM.organizerUserId)?.id ?? null;
  // Hosts that no longer host the meeting (round robin reassignment through the reschedule) lose their copy.
  const hostRows = await db.select({ userId: scheduledEventHosts.userId }).from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, newM.id));
  const hostIds = new Set(hostRows.map((h) => h.userId));
  for (const r of rows) {
    if (!hostIds.has(r.userId)) await deleteLinkedEvent({ linkedEventId: r.id, notifyAttendees: newM.settingsSnapshot?.notificationMode === "calendar_invitation" });
  }
  const fromCalendar = meetingMetaOf(newM.metadata).origin === "calendar_sync";
  if (!fromCalendar && newM.status === "active" && oldM && oldM.organizerUserId === newM.organizerUserId) {
    const loc = newM.location;
    // VID-14: a standalone conference of the same host is updated (Meet moves with its calendar event).
    if (loc?.kind && conferenceMode(loc.kind) === "standalone" && loc.status === "pushed") {
      try {
        const [organizer] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, newM.organizerUserId)).limit(1);
        const updated = await updateConference({ location: loc, organizerUserId: newM.organizerUserId, title: newM.name, start: newM.startAt, end: newM.endAt, timeZone: organizer?.timezone ?? "UTC" });
        if (updated !== loc) await db.update(scheduledEvents).set({ location: updated }).where(eq(scheduledEvents.id, newM.id));
      } catch (e) {
        log.warn("lifecycle.conference_update_failed", { scheduledEventId: newM.id, error: e });
      }
    }
  }
  const out = await provisionMeeting(db, newM.id, { skipProviderWrite: fromCalendar, existingLinkedEventId });
  if (fromCalendar) {
    // CR-17: the provider event already shows the new time; only its buffer events follow (CAL-13).
    await syncBufferEvents({ userId: newM.organizerUserId, scheduledEventId: newM.id }).catch((e: unknown) => {
      log.warn("lifecycle.buffer_sync_failed", { scheduledEventId: newM.id, error: e });
    });
  }
  await afterProvision(db, newM.id, out, { inviteeIds: [newInviteeId] });
}

export async function onMeetingUpdated(event: DomainEvent<"meeting.updated">, ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const { scheduledEventId, fields } = event.payload;
  const relevant = fields.filter((f) => f !== "notes");
  if (!relevant.length) return; // notes are host-only and never reach calendars or invitees (CR-14)
  const [m] = await db.select({ status: scheduledEvents.status, organizerUserId: scheduledEvents.organizerUserId }).from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).limit(1);
  if (!m || m.status !== "active") return;
  await provisionMeeting(db, scheduledEventId);
  if (fields.includes("buffers")) {
    await syncBufferEvents({ userId: m.organizerUserId, scheduledEventId }).catch((e: unknown) => {
      log.warn("lifecycle.buffer_sync_failed", { scheduledEventId, error: e });
    });
  }
}
