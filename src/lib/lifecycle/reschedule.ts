// Reschedules and moves (SPEC CR-03, CR-04, CR-07, CR-08, CR-09, MP-21, SCH-23, SCH-24, VID-14):
//
//   rescheduleInvitee   a new booking that replaces the invitee's meeting, through booking-core createBooking with the
//                       reschedule variant (same transaction: the old invitee canceled and linked, the ICS UID kept with
//                       SEQUENCE + 1, booking.rescheduled). Prefilled with the stored details (CR-03), normal availability
//                       for invitees, "Override available times" for a single host (OO-14). Refused for invitees once the
//                       meeting started, inside the cutoff (SCH-23), for one-off and poll meetings and event types that are
//                       off or deleted. After "Share new times to meet" the canceled invitee books again (a new booking
//                       linked from the old invitee; its reminder is canceled).
//   requestReschedule   CR-08: cancels with the host's message and emails "{Host} would like to reschedule" with a
//                       "Pick a new time" link (valid 30 days) and an optional reminder after 1, 3 or 7 days.
//   moveScheduledEvent  MP-21 in-place move: same row and UID, SEQUENCE + 1, the provider event and conference updated
//                       and "Updated" emails, by the lifecycle.meeting_moved job.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { isUniqueViolation } from "@/db/helpers";
import { invitees, scheduledEventHosts, scheduledEvents } from "@/db/schema";
import { createBooking, lockHostsInTx, type CreateBookingInput, type CreateBookingResult } from "@/lib/booking";
import { AppError } from "@/lib/errors";
import messages from "@/lib/i18n/messages/en/lifecycle";
import { isUuid } from "@/lib/ids";
import { cancelJobs, enqueueJob, runJobsAfterResponse } from "@/lib/jobs";
import { now } from "@/lib/time/now";
import { recordActivity } from "./activity";
import { actorUser, assertCanManageMeeting } from "./authorize";
import { cancelOne } from "./cancel";
import { loadInvitee, loadMeeting, meetingHostIds } from "./load";
import { inviteeRescheduleBlock, isRebookable } from "./policy";
import { JOB_TYPES, inviteeMetaOf, withLifecycleMeta, type LifecycleActor, type LifecycleInviteeMeta, type LifecycleMeetingMeta } from "./types";

type Failure = Extract<CreateBookingResult, { ok: false }>;
const fail = (code: Failure["code"], message: string): Failure => ({ ok: false, code, message });

export const requestReminderGroup = (inviteeId: string) => `lifecycle:rr:${inviteeId}`;

export type RescheduleInput = {
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
};

/** See the file header. Returns booking-core's result (refusals as { ok: false } with the CR-03 copy). */
export async function rescheduleInvitee(p: RescheduleInput, ctx: { ip?: string; now?: Date } = {}): Promise<CreateBookingResult> {
  if (!isUuid(p.inviteeId)) return fail("not_found", messages.errors.notFound);
  const db = await getDb();
  const at = ctx.now ?? now();
  const inv = await loadInvitee(db, p.inviteeId);
  if (!inv) return fail("not_found", messages.errors.notFound);
  const b = await loadMeeting(db, inv.scheduledEventId);
  if (!b) return fail("not_found", messages.errors.notFound);
  if ((p.reason ?? "").trim().length > 2000) return fail("validation", messages.changes.reasonTooLong);
  const m = b.meeting;
  const subject = {
    invitee: inv,
    meeting: { status: m.status, startAt: m.startAt, source: m.source, changeCutoffMinutes: m.settingsSnapshot?.changeCutoffMinutes ?? null },
    eventType: b.eventType,
    host: { name: b.organizer?.name ?? "", email: b.organizer?.email ?? null },
    now: at,
  };
  const rebook = isRebookable(subject);
  let actor: NonNullable<CreateBookingInput["actor"]>;
  if (p.actor.type === "invitee") {
    const block = inviteeRescheduleBlock(subject);
    if (block) return fail(block.reason === "cutoff" ? "validation" : "slot_unavailable", block.message);
    actor = { type: "invitee" };
  } else {
    if (p.actor.type === "user" || p.actor.type === "api") await assertCanManageMeeting(db, p.actor, m.id);
    if ((inv.status !== "active" || m.status !== "active") && !rebook) return fail("slot_unavailable", messages.changes.notReschedulable);
    if (m.source === "one_off" || m.source === "poll") return fail("slot_unavailable", messages.changes.notReschedulable);
    const override = Boolean(p.host?.overrideAvailability);
    if (override && b.hosts.length > 1) return fail("validation", messages.errors.overrideMultiHost);
    const user = actorUser(p.actor);
    if (p.actor.type === "api") actor = { type: "api", userId: user!.id };
    else actor = { type: "host", userId: user?.id ?? m.organizerUserId, overrideAvailability: override };
  }

  // CR-03: prefilled with the stored details (all editable); the original location choice when it is still offered.
  const offered = new Set((b.eventType?.locations ?? []).map((l) => l.id));
  const stored = inv.locationAnswer && offered.has(inv.locationAnswer.configId) ? { configId: inv.locationAnswer.configId, value: inv.locationAnswer.value } : undefined;
  const guests = b.guests.filter((g) => g.inviteeId === inv.id && (rebook || !g.canceledAt)).map((g) => g.email);
  const input: CreateBookingInput = {
    target: { kind: "event_type", eventTypeId: inv.eventTypeId },
    start: p.start,
    durationMinutes: p.durationMinutes ?? m.durationMinutes,
    invitee: {
      name: inv.name,
      firstName: inv.firstName ?? undefined,
      lastName: inv.lastName ?? undefined,
      email: inv.email,
      timezone: inv.timezone ?? b.organizer?.timezone ?? "UTC",
      detectedTimezone: inv.detectedTimezone,
      timeFormat: inv.timeFormat === "24h" || inv.timeFormat === "12h" ? inv.timeFormat : null,
      locale: inv.locale ?? undefined,
      textReminderNumber: inv.textReminderNumber,
      marketingConsent: inv.marketingConsent,
      ...(p.invitee ?? {}),
    },
    guests: p.guests ?? guests,
    locationAnswer: p.locationAnswer ?? stored,
    answers:
      p.answers ??
      (inv.questionsAndAnswers ?? [])
        .filter((a) => a.questionId)
        .map((a) => ({ questionId: a.questionId!, value: a.type === "multi_select" ? (a.values ?? a.answer.split("\n").filter(Boolean)) : a.answer })),
    tracking: {
      ...(inv.utmSource ? { utmSource: inv.utmSource } : {}),
      ...(inv.utmMedium ? { utmMedium: inv.utmMedium } : {}),
      ...(inv.utmCampaign ? { utmCampaign: inv.utmCampaign } : {}),
      ...(inv.utmContent ? { utmContent: inv.utmContent } : {}),
      ...(inv.utmTerm ? { utmTerm: inv.utmTerm } : {}),
      ...(inv.salesforceUuid ? { salesforceUuid: inv.salesforceUuid } : {}),
    },
    reschedule: rebook ? null : { inviteeId: inv.id, reason: p.reason?.trim() || null },
    actor,
    ...(p.clientRequestId ? { clientRequestId: p.clientRequestId } : {}),
  };
  const result = await createBooking(input, { ip: ctx.ip, now: ctx.now });
  if (result.ok && rebook) await linkRebooking(inv.id, result.inviteeId);
  return result;
}

/** CR-08: the canceled invitee booked again: link it (old links lead to the new booking) and stop the reminder. */
async function linkRebooking(oldInviteeId: string, newInviteeId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [old] = await tx.select().from(invitees).where(eq(invitees.id, oldInviteeId)).for("update").limit(1);
    if (!old || old.newInviteeId) return;
    const meta = inviteeMetaOf(old.metadata);
    await tx
      .update(invitees)
      .set({
        newInviteeId,
        metadata: withLifecycleMeta<LifecycleInviteeMeta>(old.metadata, {
          requestReschedule: meta.requestReschedule ? { ...meta.requestReschedule, rebookedInviteeId: newInviteeId } : null,
        }),
        updatedAt: now(),
      })
      .where(eq(invitees.id, oldInviteeId));
    await cancelJobs(tx, { groupKey: requestReminderGroup(oldInviteeId) });
  });
}

/** CR-08 "Share new times to meet". */
export async function requestReschedule(p: {
  inviteeId: string;
  actor: LifecycleActor;
  message?: string | null;
  reminderDays?: 1 | 3 | 7 | null;
}): Promise<void> {
  if (p.actor.type === "invitee") throw new AppError("forbidden", messages.errors.forbidden);
  const message = (p.message ?? "").trim();
  if (message.length > 2000) throw new AppError("validation", messages.changes.messageTooLong, { fieldErrors: { message: [messages.changes.messageTooLong] } });
  if (p.reminderDays != null && ![1, 3, 7].includes(p.reminderDays)) throw new AppError("validation", "Choose a reminder after 1, 3 or 7 days.");
  const db = await getDb();
  const inv = await loadInvitee(db, p.inviteeId);
  if (!inv) throw new AppError("not_found", messages.errors.notFound);
  const [m] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, inv.scheduledEventId)).limit(1);
  if (!m) throw new AppError("not_found", messages.errors.notFound);
  await assertCanManageMeeting(db, p.actor, m.id);
  const at = now();
  if (m.startAt.getTime() <= at.getTime()) throw new AppError("validation", messages.errors.requestPast);
  if (m.source === "one_off" || m.source === "poll") throw new AppError("validation", messages.changes.notReschedulable);
  const user = actorUser(p.actor);
  const days = p.reminderDays ?? null;
  await cancelOne({
    inviteeId: inv.id,
    actor: p.actor,
    reason: message || messages.reasons.hostAskedNewTime,
    kind: "request_reschedule",
    invitee: { requestReschedule: { requestedAt: at.toISOString(), message: message || null, reminderDays: days, byUserId: user?.id ?? null, rebookedInviteeId: null } },
    extra: async (tx, { invitee }) => {
      if (!days) return;
      await enqueueJob(tx, {
        type: JOB_TYPES.requestRescheduleReminder,
        payload: { inviteeId: invitee.id, days },
        runAt: new Date(at.getTime() + days * 86_400_000),
        idempotencyKey: `rr-reminder:${invitee.id}`,
        groupKey: requestReminderGroup(invitee.id),
      });
    },
  });
}

/** MP-21 in-place move (see the file header). */
export async function moveScheduledEvent(p: { scheduledEventId: string; start: Date; end: Date; actor: LifecycleActor }): Promise<void> {
  if (!isUuid(p.scheduledEventId)) throw new AppError("not_found", messages.errors.notFound);
  if (p.actor.type === "invitee") throw new AppError("forbidden", messages.errors.forbidden);
  const start = new Date(p.start);
  const end = new Date(p.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new AppError("validation", messages.errors.moveInvalid);
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (minutes > 720) throw new AppError("validation", messages.errors.moveTooLong);
  const db = await getDb();
  const [m0] = await db.select({ id: scheduledEvents.id }).from(scheduledEvents).where(eq(scheduledEvents.id, p.scheduledEventId)).limit(1);
  if (!m0) throw new AppError("not_found", messages.errors.notFound);
  await assertCanManageMeeting(db, p.actor, m0.id);
  const hostIds = await meetingHostIds(db, [m0.id]);
  const at = now();
  try {
    const moved = await db.transaction(async (tx) => {
      await lockHostsInTx(tx, hostIds);
      const [m] = await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, m0.id)).for("update").limit(1);
      if (!m || m.status !== "active") throw new AppError("conflict", messages.errors.meetingCanceled);
      if (m.startAt.getTime() === start.getTime() && m.endAt.getTime() === end.getTime()) return false;
      const sequence = m.icsSequence + 1;
      const lastMove: LifecycleMeetingMeta["lastMove"] = { fromStart: m.startAt.toISOString(), fromEnd: m.endAt.toISOString(), at: at.toISOString(), sequence };
      await tx
        .update(scheduledEvents)
        .set({ startAt: start, endAt: end, durationMinutes: minutes, icsSequence: sequence, metadata: withLifecycleMeta<LifecycleMeetingMeta>(m.metadata, { lastMove }), updatedAt: at })
        .where(eq(scheduledEvents.id, m.id));
      await tx
        .update(scheduledEventHosts)
        .set({
          startAt: start,
          endAt: end,
          bufferedStartAt: new Date(start.getTime() - m.bufferBeforeMinutes * 60_000),
          bufferedEndAt: new Date(end.getTime() + m.bufferAfterMinutes * 60_000),
          updatedAt: at,
        })
        .where(eq(scheduledEventHosts.scheduledEventId, m.id));
      await recordActivity(tx, [
        { scheduledEventId: m.id, type: "rescheduled_to", actor: p.actor, data: { inPlace: true, from: { start: lastMove.fromStart, end: lastMove.fromEnd }, to: { start: start.toISOString(), end: end.toISOString() } } },
      ]);
      await enqueueJob(tx, {
        type: JOB_TYPES.meetingMoved,
        payload: { scheduledEventId: m.id, fromStart: lastMove.fromStart, fromEnd: lastMove.fromEnd, sequence },
        idempotencyKey: `moved:${m.id}:${sequence}`,
        groupKey: `lifecycle:meeting:${m.id}`,
        priority: 10,
      });
      return true;
    });
    if (moved) runJobsAfterResponse({ types: [JOB_TYPES.meetingMoved] });
  } catch (e) {
    if (isUniqueViolation(e, "sched_group_slot_uq")) throw new AppError("conflict", "That time is no longer available. Please choose another time.");
    throw e;
  }
}
