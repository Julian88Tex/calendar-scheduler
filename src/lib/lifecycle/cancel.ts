// Cancellations (SPEC CR-02, CR-05, CR-06, CR-08, CR-10, CR-12, CR-16, CR-17, SCH-23, NT-03; ARCHITECTURE 9 lock order):
//
//   cancelInvitee          one invitee (the meeting too when it was the last active invitee); invitees through the
//                          capability URL obey the CR-02 and SCH-23 rules, hosts are never limited by the cutoff.
//   cancelScheduledEvent   host cancel of the whole meeting (every invitee of a group slot).
//   removeInvitee          host cancel of one group invitee ("Remove invitee", CR-10).
//
// Every cancel takes the meeting's host locks (lockHostsInTx), then the invitee row (lockInviteeForChangeInTx), then
// the meeting row, so a cancel racing a reschedule serializes and the loser sees the invitee already canceled or
// rescheduled. In the same transaction: invitee canceled (canceled_at, reason, canceler), guests canceled, the meeting
// canceled when no active invitee remains (status, canceled_at, scheduled_event_hosts.is_active = false, the ICS
// SEQUENCE + 1), the timeline row and booking.canceled with an accurate meetingCanceled flag. Side effects (calendar
// delete, emails, workflow jobs) run in the subscribers right after the response (runJobsAfterResponse).
import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx, type Tx } from "@/db";
import { inviteeGuests, invitees, scheduledEventHosts, scheduledEvents, users } from "@/db/schema";
import { lockHostsInTx, lockInviteeForChangeInTx, type InviteeRow } from "@/lib/booking";
import { isAppError, AppError } from "@/lib/errors";
import { eventJobPattern, publishEvent } from "@/lib/events";
import messages from "@/lib/i18n/messages/en/lifecycle";
import { isUuid } from "@/lib/ids";
import { runJobsAfterResponse } from "@/lib/jobs";
import { now } from "@/lib/time/now";
import { recordActivity, type ActivityType } from "./activity";
import { actorUser, assertCanManageMeeting, domainActorOf } from "./authorize";
import { loadInvitee, meetingHostIds } from "./load";
import { cancelReasonProblem, inviteeCancelBlock } from "./policy";
import { JOB_TYPES, withLifecycleMeta, type CancelKind, type LifecycleActor, type LifecycleInviteeMeta, type LifecycleMeetingMeta } from "./types";

type MeetingRow = typeof scheduledEvents.$inferSelect;

/** Who canceled, as stored on the rows (CR-04, CR-17). */
export type Canceler = { type: "host" | "invitee" | "system"; userId: string | null; name: string | null };

export function cancelerOf(actor: LifecycleActor, invitee: Pick<InviteeRow, "name">): Canceler {
  const user = actorUser(actor);
  if (user) return { type: "host", userId: user.id, name: user.name };
  if (actor.type === "invitee") return { type: "invitee", userId: null, name: actor.name?.trim() || invitee.name };
  return { type: "system", userId: null, name: actor.type === "system" ? (actor.name ?? null) : null };
}

/** Maps lockInviteeForChangeInTx conflicts to the CR-02 copy. */
function changeConflict(e: unknown): never {
  if (isAppError(e) && e.code === "conflict") {
    const reason = (e.details as { reason?: string } | undefined)?.reason;
    throw new AppError("conflict", reason === "rescheduled" ? messages.changes.rescheduled : messages.changes.canceled, { details: { reason: reason ?? "canceled" } });
  }
  if (isAppError(e) && e.code === "not_found") throw new AppError("not_found", messages.errors.notFound);
  throw e;
}

function validReason(reason: string | null | undefined): string | null {
  const r = (reason ?? "").trim();
  if (r.length > 2000) throw new AppError("validation", messages.changes.reasonTooLong, { fieldErrors: { reason: [messages.changes.reasonTooLong] } });
  return r || null;
}

export type CancelRowsInput = {
  meeting: MeetingRow;
  /** Locked, active invitees to cancel. */
  invitees: InviteeRow[];
  canceler: Canceler;
  reason: string | null;
  actor: LifecycleActor;
  kind?: CancelKind | null;
  notify?: boolean;
  invitee?: Partial<LifecycleInviteeMeta>;
  activity?: ActivityType;
  at: Date;
};

/**
 * Cancels locked invitee rows and, when none stays active, the meeting (call after the host, invitee and meeting
 * locks). Publishes one booking.canceled per invitee. Returns whether the meeting was canceled.
 */
export async function cancelRowsInTx(tx: DbOrTx, p: CancelRowsInput): Promise<{ meetingCanceled: boolean }> {
  const m = p.meeting;
  const ids = p.invitees.map((i) => i.id);
  for (const inv of p.invitees) {
    await tx
      .update(invitees)
      .set({
        status: "canceled",
        canceledAt: p.at,
        cancelReason: p.reason,
        cancelerType: p.canceler.type,
        canceledByUserId: p.canceler.userId,
        canceledByName: p.canceler.name,
        metadata: withLifecycleMeta<LifecycleInviteeMeta>(inv.metadata, { cancelKind: p.kind ?? null, notify: p.notify !== false, ...(p.invitee ?? {}) }),
        updatedAt: p.at,
      })
      .where(eq(invitees.id, inv.id));
    await tx.update(inviteeGuests).set({ canceledAt: p.at, updatedAt: p.at }).where(and(eq(inviteeGuests.inviteeId, inv.id), isNull(inviteeGuests.canceledAt)));
  }
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(invitees)
    .where(and(eq(invitees.scheduledEventId, m.id), eq(invitees.status, "active")));
  const meetingCanceled = Number(n) === 0;
  if (meetingCanceled) {
    const lifecycle: Partial<LifecycleMeetingMeta> = ids.length > 1 ? { canceledAsWhole: true } : {};
    await tx
      .update(scheduledEvents)
      .set({
        status: "canceled",
        canceledAt: p.at,
        cancelReason: p.reason,
        cancelerType: p.canceler.type,
        canceledByUserId: p.canceler.userId,
        canceledByName: p.canceler.name,
        // NT-06: the CANCEL of a one-on-one meeting keeps the UID with the next SEQUENCE.
        icsSequence: m.isGroup ? m.icsSequence : m.icsSequence + 1,
        metadata: withLifecycleMeta<LifecycleMeetingMeta>(m.metadata, lifecycle),
        updatedAt: p.at,
      })
      .where(eq(scheduledEvents.id, m.id));
    await tx.update(scheduledEventHosts).set({ isActive: false, updatedAt: p.at }).where(eq(scheduledEventHosts.scheduledEventId, m.id));
  }
  await recordActivity(
    tx,
    p.invitees.map((inv) => ({
      scheduledEventId: m.id,
      inviteeId: inv.id,
      type: p.activity ?? (meetingCanceled ? "canceled" : "invitee_canceled"),
      actor: p.actor,
      data: { reason: p.reason, cancelerType: p.canceler.type, canceledBy: p.canceler.name, kind: p.kind ?? null, meetingCanceled },
    })),
  );
  for (const inv of p.invitees) {
    await publishEvent(
      tx,
      "booking.canceled",
      { scheduledEventId: m.id, inviteeId: inv.id, cancelerType: p.canceler.type, reason: p.reason, meetingCanceled },
      { organizationId: m.organizationId, actor: domainActorOf(p.actor, inv.name) },
    );
  }
  return { meetingCanceled };
}

/** Runs the subscriber jobs of a cancellation right after the response (NT-23). */
export function runCancelJobsSoon(): void {
  runJobsAfterResponse({ types: [eventJobPattern("booking.canceled"), `${JOB_TYPES.requestRescheduleReminder}`] });
}

export type CancelOneInput = {
  inviteeId: string;
  actor: LifecycleActor;
  reason?: string | null;
  notify?: boolean;
  kind?: CancelKind | null;
  /** Internal callers (calendar sync, account deletion) cancel "as the host". */
  canceler?: Canceler;
  activity?: ActivityType;
  invitee?: Partial<LifecycleInviteeMeta>;
  /** Extra writes in the same transaction (after the cancel). */
  extra?: (tx: Tx, p: { invitee: InviteeRow; meeting: MeetingRow }) => Promise<void>;
  /** Business time (tests). */
  now?: Date;
};

/** The shared core of cancelInvitee, removeInvitee and requestReschedule (see the file header). */
export async function cancelOne(p: CancelOneInput): Promise<{ inviteeId: string; scheduledEventId: string; meetingCanceled: boolean }> {
  if (!isUuid(p.inviteeId)) throw new AppError("not_found", messages.errors.notFound);
  const db = await getDb();
  const at = p.now ?? now();
  const inv0 = await loadInvitee(db, p.inviteeId);
  if (!inv0) throw new AppError("not_found", messages.errors.notFound);
  const [m0] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, inv0.scheduledEventId)).limit(1);
  if (!m0) throw new AppError("not_found", messages.errors.notFound);
  const reason = validReason(p.reason);
  if (p.actor.type === "user" || p.actor.type === "api") await assertCanManageMeeting(db, p.actor, m0.id);

  const hostIds = await meetingHostIds(db, [m0.id]);
  const [organizer] = await db.select({ name: users.name }).from(users).where(eq(users.id, m0.organizerUserId)).limit(1);
  const hostName = organizer?.name ?? "";
  const result = await db.transaction(
    async (tx) => {
      await lockHostsInTx(tx, hostIds);
      const inv = await lockInviteeForChangeInTx(tx, p.inviteeId).catch(changeConflict);
      const [m] = await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, inv.scheduledEventId)).for("update").limit(1);
      if (!m || m.status !== "active") throw new AppError("conflict", messages.changes.canceled, { details: { reason: "canceled" } });
      if (p.actor.type === "invitee") {
        // CR-02 and SCH-23 on the locked rows (a cancel page left open past the start or into the cutoff).
        const block = inviteeCancelBlock({
          invitee: inv,
          meeting: { status: m.status, startAt: m.startAt, source: m.source, changeCutoffMinutes: m.settingsSnapshot?.changeCutoffMinutes ?? null },
          eventType: null,
          host: { name: hostName },
          now: at,
        });
        if (block) throw new AppError("conflict", block.message, { details: { reason: block.reason } });
        const problem = cancelReasonProblem(reason, m.settingsSnapshot?.requireCancelReason === true);
        if (problem) throw new AppError("validation", problem, { fieldErrors: { reason: [problem] } });
      }
      const canceler = p.canceler ?? cancelerOf(p.actor, inv);
      const out = await cancelRowsInTx(tx, {
        meeting: m,
        invitees: [inv],
        canceler,
        reason,
        actor: p.actor,
        kind: p.kind,
        notify: p.notify,
        invitee: p.invitee,
        activity: p.activity,
        at,
      });
      if (p.extra) await p.extra(tx as Tx, { invitee: inv, meeting: m });
      return { inviteeId: inv.id, scheduledEventId: m.id, meetingCanceled: out.meetingCanceled };
    },
    { isolationLevel: "read committed" },
  );
  runCancelJobsSoon();
  return result;
}

/** Cancels one invitee (the meeting too when it was the last active invitee). Invitee reason rules per CR-02/CR-05. */
export async function cancelInvitee(p: {
  inviteeId: string;
  actor: LifecycleActor;
  reason?: string | null;
  notify?: boolean;
}): Promise<{ inviteeId: string; scheduledEventId: string; meetingCanceled: boolean }> {
  return cancelOne({ inviteeId: p.inviteeId, actor: p.actor, reason: p.reason, notify: p.notify });
}

/** CR-10 "Remove invitee": host cancel of one group invitee. */
export async function removeInvitee(p: { inviteeId: string; actor: LifecycleActor; reason?: string | null }): Promise<void> {
  if (p.actor.type === "invitee") throw new AppError("forbidden", messages.errors.forbidden);
  await cancelOne({ inviteeId: p.inviteeId, actor: p.actor, reason: p.reason, kind: "removed", activity: "invitee_removed" });
}

export type CancelMeetingInput = {
  scheduledEventId: string;
  actor: LifecycleActor;
  reason?: string | null;
  notify?: boolean;
  kind?: CancelKind | null;
  canceler?: Canceler;
  now?: Date;
};

/** Host cancel of the whole meeting (all invitees of a group slot, CR-06). */
export async function cancelMeeting(p: CancelMeetingInput): Promise<{ scheduledEventId: string; canceledInviteeIds: string[] }> {
  if (!isUuid(p.scheduledEventId)) throw new AppError("not_found", messages.errors.notFound);
  if (p.actor.type === "invitee") throw new AppError("forbidden", messages.errors.forbidden);
  const db = await getDb();
  const at = p.now ?? now();
  const reason = validReason(p.reason);
  const [m0] = await db.select({ id: scheduledEvents.id }).from(scheduledEvents).where(eq(scheduledEvents.id, p.scheduledEventId)).limit(1);
  if (!m0) throw new AppError("not_found", messages.errors.notFound);
  await assertCanManageMeeting(db, p.actor, m0.id);
  const hostIds = await meetingHostIds(db, [m0.id]);
  const result = await db.transaction(
    async (tx) => {
      await lockHostsInTx(tx, hostIds);
      // Lock order step 2: the invitees (ascending id), then the meeting row.
      const candidates = await tx
        .select({ id: invitees.id })
        .from(invitees)
        .where(and(eq(invitees.scheduledEventId, m0.id), eq(invitees.status, "active")))
        .orderBy(asc(invitees.id));
      const locked: InviteeRow[] = [];
      for (const c of candidates) {
        try {
          locked.push(await lockInviteeForChangeInTx(tx, c.id));
        } catch (e) {
          if (!isAppError(e) || e.code !== "conflict") throw e; // canceled or rescheduled meanwhile
        }
      }
      const [m] = await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, m0.id)).for("update").limit(1);
      if (!m || m.status !== "active") throw new AppError("conflict", messages.errors.meetingCanceled, { details: { reason: "canceled" } });
      if (!locked.length) {
        // No invitee left (all canceled meanwhile): the meeting itself still goes.
        await tx
          .update(scheduledEvents)
          .set({ status: "canceled", canceledAt: at, cancelReason: reason, cancelerType: "host", updatedAt: at })
          .where(eq(scheduledEvents.id, m.id));
        await tx.update(scheduledEventHosts).set({ isActive: false, updatedAt: at }).where(eq(scheduledEventHosts.scheduledEventId, m.id));
        return { scheduledEventId: m.id, canceledInviteeIds: [] as string[] };
      }
      const user = actorUser(p.actor);
      const canceler: Canceler = p.canceler ?? (user ? { type: "host", userId: user.id, name: user.name } : { type: "system", userId: null, name: p.actor.type === "system" ? (p.actor.name ?? null) : null });
      await cancelRowsInTx(tx, { meeting: m, invitees: locked, canceler, reason, actor: p.actor, kind: p.kind, notify: p.notify, at });
      return { scheduledEventId: m.id, canceledInviteeIds: locked.map((i) => i.id) };
    },
    { isolationLevel: "read committed" },
  );
  runCancelJobsSoon();
  return result;
}

/** Host cancel of the whole meeting (all invitees of a group slot, CR-06). */
export async function cancelScheduledEvent(p: {
  scheduledEventId: string;
  actor: LifecycleActor;
  reason?: string | null;
  notify?: boolean;
}): Promise<{ scheduledEventId: string; canceledInviteeIds: string[] }> {
  return cancelMeeting(p);
}
