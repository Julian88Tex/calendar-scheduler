// Scheduling side of the workflow engine (SPEC NT-15, NT-19; ARCHITECTURE section 14), called by the domain event
// subscribers (subscribers.ts) inside one transaction per event:
// - booking.created: executions for the new invitee (booked and timed triggers);
// - booking.canceled: pending executions canceled (the invitee's, or the whole meeting's), then "Event is canceled"
//   executions (never for group events);
// - booking.rescheduled: the old invitee's pending executions canceled, the new invitee scheduled with the current
//   workflow config plus "Event is rescheduled"; a reschedule that keeps the invitee (in-place move) re-times instead;
// - booking.no_show_created: "No-show marked" executions (pending "Event ends" ones are skipped at send time).
// Every write is idempotent (execution keys), so a retried subscriber job never duplicates anything.
import "server-only";
import { and, count, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { inviteeNoShows, invitees, scheduledEvents, workflowExecutions } from "@/db/schema";
import { now as clockNow } from "@/lib/time/now";
import { computeExecutions, TIMED_TRIGGERS, type EngineInvitee, type EngineMeeting, type WorkflowTrigger } from "./engine";
import {
  cancelExecutions,
  engineSteps,
  engineWorkflow,
  recordActivity,
  retimeExecutions,
  upsertExecutions,
  workflowsForEventType,
  type ExecutionInsert,
  type UpsertResult,
} from "./store";

export type MeetingForEngine = EngineMeeting & { organizationId: string; eventTypeId: string };

/** The meeting fields the engine needs, with its active invitee count; null when it does not exist. */
export async function loadMeeting(db: DbOrTx, scheduledEventId: string): Promise<MeetingForEngine | null> {
  const [row] = await db
    .select({
      id: scheduledEvents.id,
      organizationId: scheduledEvents.organizationId,
      eventTypeId: scheduledEvents.eventTypeId,
      startAt: scheduledEvents.startAt,
      endAt: scheduledEvents.endAt,
      isGroup: scheduledEvents.isGroup,
      status: scheduledEvents.status,
      pollId: scheduledEvents.pollId,
      oneOffMeetingId: scheduledEvents.oneOffMeetingId,
    })
    .from(scheduledEvents)
    .where(eq(scheduledEvents.id, scheduledEventId))
    .limit(1);
  if (!row) return null;
  const [active] = await db
    .select({ n: count() })
    .from(invitees)
    .where(and(eq(invitees.scheduledEventId, row.id), eq(invitees.status, "active")));
  return { ...row, activeInviteeCount: Number(active?.n ?? 0) };
}

async function loadInvitee(db: DbOrTx, inviteeId: string) {
  const [row] = await db
    .select({
      id: invitees.id,
      status: invitees.status,
      createdAt: invitees.createdAt,
      scheduledEventId: invitees.scheduledEventId,
      canceledAt: invitees.canceledAt,
    })
    .from(invitees)
    .where(eq(invitees.id, inviteeId))
    .limit(1);
  return row ?? null;
}

export type ScheduleOutcome = { scheduled: number; skipped: number };

/**
 * Computes and writes the executions of every active workflow of the meeting's event type for `triggers` and the
 * given invitees. Skipped results (booked too close) are stored and logged in the meeting activity.
 */
export async function scheduleExecutions(
  tx: DbOrTx,
  meeting: MeetingForEngine,
  targets: readonly EngineInvitee[],
  triggers: readonly WorkflowTrigger[],
  opts: { now?: Date; eventAt?: Date; reviveReasons?: readonly string[] } = {},
): Promise<ScheduleOutcome> {
  if (meeting.pollId || meeting.oneOffMeetingId || !targets.length) return { scheduled: 0, skipped: 0 };
  const at = opts.now ?? clockNow();
  const list = await workflowsForEventType(tx, { organizationId: meeting.organizationId, eventTypeId: meeting.eventTypeId, triggers });
  const rows: ExecutionInsert[] = [];
  for (const { workflow, steps } of list) {
    const computed = computeExecutions(engineWorkflow(workflow), engineSteps(steps), meeting, targets, workflow.trigger, {
      now: at,
      eventAt: opts.eventAt,
    });
    for (const c of computed) rows.push({ ...c, workflowId: workflow.id, scheduledEventId: meeting.id });
  }
  const result = await upsertExecutions(tx, rows, { reviveReasons: opts.reviveReasons });
  await logSkips(tx, result, rows);
  return {
    scheduled: result.written.filter((w) => w.status === "scheduled").length,
    skipped: result.written.filter((w) => w.status === "skipped").length,
  };
}

async function logSkips(tx: DbOrTx, result: UpsertResult, rows: readonly ExecutionInsert[]): Promise<void> {
  const byKey = new Map(rows.map((r) => [r.idempotencyKey, r]));
  const skipped = result.written.filter((w) => w.status === "skipped");
  if (!skipped.length) return;
  await recordActivity(
    tx,
    skipped.map((w) => {
      const source = byKey.get(w.key);
      return {
        scheduledEventId: w.scheduledEventId,
        inviteeId: w.inviteeId,
        type: "workflow_skipped" as const,
        data: {
          executionId: w.id,
          workflowId: w.workflowId,
          workflowName: source?.snapshot.workflowName ?? null,
          action: source?.snapshot.action ?? null,
          trigger: source?.trigger ?? null,
          reason: w.skipReason,
        },
      };
    }),
  );
}

/** booking.created: executions for the new invitee (booked, before_start, starts, ends). */
export async function scheduleForBooking(tx: DbOrTx, p: { scheduledEventId: string; inviteeId: string; now?: Date }): Promise<ScheduleOutcome> {
  const meeting = await loadMeeting(tx, p.scheduledEventId);
  const invitee = await loadInvitee(tx, p.inviteeId);
  if (!meeting || !invitee || invitee.scheduledEventId !== meeting.id) return { scheduled: 0, skipped: 0 };
  if (meeting.status !== "active" || invitee.status !== "active") return { scheduled: 0, skipped: 0 };
  return scheduleExecutions(tx, meeting, [invitee], ["booked", ...TIMED_TRIGGERS], { now: p.now });
}

/** booking.canceled: cancel pending executions, then schedule "Event is canceled" ones for the invitee. */
export async function handleCancellation(
  tx: DbOrTx,
  p: { scheduledEventId: string; inviteeId: string; meetingCanceled: boolean; now?: Date },
): Promise<{ canceled: number } & ScheduleOutcome> {
  const canceledIds = p.meetingCanceled
    ? await cancelExecutions(tx, eq(workflowExecutions.scheduledEventId, p.scheduledEventId), "meeting_canceled")
    : await cancelExecutions(tx, eq(workflowExecutions.inviteeId, p.inviteeId), "invitee_canceled");
  const meeting = await loadMeeting(tx, p.scheduledEventId);
  const invitee = await loadInvitee(tx, p.inviteeId);
  if (!meeting || !invitee || invitee.scheduledEventId !== meeting.id) return { canceled: canceledIds.length, scheduled: 0, skipped: 0 };
  const at = p.now ?? clockNow();
  const outcome = await scheduleExecutions(tx, meeting, [{ ...invitee, status: "canceled" }], ["canceled"], {
    now: at,
    eventAt: invitee.canceledAt ?? at,
  });
  return { canceled: canceledIds.length, ...outcome };
}

/** booking.rescheduled (see the file header). */
export async function handleReschedule(
  tx: DbOrTx,
  p: { oldInviteeId: string; newInviteeId: string; oldScheduledEventId: string; newScheduledEventId: string; now?: Date },
): Promise<{ canceled: number; retimed: number } & ScheduleOutcome> {
  const at = p.now ?? clockNow();
  if (p.oldInviteeId === p.newInviteeId) {
    // In-place move: same invitee and executions, new times.
    const retimed = await retimeExecutions(tx, eq(workflowExecutions.scheduledEventId, p.newScheduledEventId));
    return { canceled: 0, retimed, scheduled: 0, skipped: 0 };
  }
  let canceled = (await cancelExecutions(tx, eq(workflowExecutions.inviteeId, p.oldInviteeId), "rescheduled")).length;
  const oldMeeting = await loadMeeting(tx, p.oldScheduledEventId);
  if (oldMeeting && oldMeeting.status !== "active") {
    canceled += (
      await cancelExecutions(
        tx,
        and(eq(workflowExecutions.scheduledEventId, p.oldScheduledEventId), isNull(workflowExecutions.inviteeId))!,
        "rescheduled",
      )
    ).length;
  }
  const meeting = await loadMeeting(tx, p.newScheduledEventId);
  const invitee = await loadInvitee(tx, p.newInviteeId);
  if (!meeting || !invitee || invitee.scheduledEventId !== meeting.id || meeting.status !== "active" || invitee.status !== "active") {
    return { canceled, retimed: 0, scheduled: 0, skipped: 0 };
  }
  // "Event is rescheduled" runs from the time of the change (this subscriber runs right after it).
  const outcome = await scheduleExecutions(tx, meeting, [invitee], [...TIMED_TRIGGERS, "rescheduled"], { now: at, eventAt: at });
  return { canceled, retimed: 0, ...outcome };
}

/** booking.no_show_created: "No-show marked" executions for the invitee. */
export async function handleNoShow(tx: DbOrTx, p: { inviteeId: string; noShowId: string; now?: Date }): Promise<ScheduleOutcome> {
  const invitee = await loadInvitee(tx, p.inviteeId);
  if (!invitee) return { scheduled: 0, skipped: 0 };
  const meeting = await loadMeeting(tx, invitee.scheduledEventId);
  if (!meeting) return { scheduled: 0, skipped: 0 };
  const [noShow] = await tx
    .select({ createdAt: inviteeNoShows.createdAt })
    .from(inviteeNoShows)
    .where(eq(inviteeNoShows.id, p.noShowId))
    .limit(1);
  const at = p.now ?? clockNow();
  return scheduleExecutions(tx, meeting, [invitee], ["no_show"], { now: at, eventAt: noShow?.createdAt ?? at });
}
