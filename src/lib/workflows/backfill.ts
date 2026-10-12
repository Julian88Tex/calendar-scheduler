// The workflows.backfill job (SPEC NT-13, NT-15 "Backfill", ET-25; ARCHITECTURE section 14): when a workflow is
// created, turned on, gains an event type, or a basic notification (Email reminders) is switched on or re-timed, the
// meetings that are already booked get the executions they would have had.
// - Scope: active invitees of active meetings of the newly covered event types that start after $now (one-off and
//   poll meetings excluded), the before_start, starts and ends triggers only, the current workflow config as the
//   snapshot; run times already in the past create nothing.
// - Idempotent on (action, invitee or slot, trigger): an existing execution is left alone, except one canceled by
//   unassignment or deactivation, which is scheduled again (so off/on and unassign/reassign never duplicate).
// - Pages of 500 invitees ordered by (start, invitee id); each page re-enqueues the next one to stay well under the
//   20 second handler budget.
import "server-only";
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db";
import { invitees, scheduledEvents, workflowEventTypes, workflowSteps, workflows } from "@/db/schema";
import { enqueueJob } from "@/lib/jobs/queue";
import { PermanentJobError, type JobContext } from "@/lib/jobs/types";
import { now as clockNow } from "@/lib/time/now";
import { computeExecutions, isTimedTrigger, type EngineInvitee } from "./engine";
import { BACKFILL_JOB, BACKFILL_JOB_PRIORITY, engineSteps, engineWorkflow, REVIVABLE_REASONS, upsertExecutions, type ExecutionInsert } from "./store";
import type { MeetingForEngine } from "./schedule";

export const BACKFILL_PAGE_SIZE = 500;

const Payload = z.object({
  workflowId: z.uuid(),
  eventTypeIds: z.array(z.uuid()).max(1000).optional(),
  /** Key of the first page job (pages derive their own keys from it). */
  rootKey: z.string().max(300).optional(),
  cursor: z.object({ startAt: z.iso.datetime({ offset: true }), inviteeId: z.uuid() }).nullable().optional(),
  /** Tests use smaller pages. */
  pageSize: z.number().int().min(1).max(BACKFILL_PAGE_SIZE).optional(),
});
export type BackfillPayload = z.infer<typeof Payload>;

export type BackfillOutcome = { scheduled: number; revived: number; meetings: number; nextPage: boolean; skipped?: string };

/** The idempotency key of a workflow's backfill for one saved version (ARCHITECTURE section 14). */
export function backfillKey(workflowId: string, version: Date | number | string): string {
  const v = version instanceof Date ? version.getTime() : version;
  return `backfill:${workflowId}:${v}`;
}

/**
 * Enqueues the backfill of a workflow in the caller's transaction (run it right after the response with
 * runJobsAfterResponse({ types: ["workflows.backfill"] })). `version` (usually the workflow's updated_at) makes each
 * save its own backfill; re-enqueueing the same version is a no-op. Returns the job id, or null when deduplicated.
 */
export async function enqueueBackfill(
  tx: DbOrTx,
  p: { workflowId: string; eventTypeIds?: string[]; version: Date | number | string },
): Promise<string | null> {
  const rootKey = backfillKey(p.workflowId, p.version);
  return enqueueJob(tx, {
    type: BACKFILL_JOB,
    payload: { workflowId: p.workflowId, ...(p.eventTypeIds ? { eventTypeIds: p.eventTypeIds } : {}), rootKey },
    priority: BACKFILL_JOB_PRIORITY,
    idempotencyKey: rootKey,
  });
}

/** The event types a workflow currently applies to. */
async function coveredEventTypes(db: DbOrTx, w: typeof workflows.$inferSelect): Promise<string[]> {
  if (w.isBasic) return w.basicEventTypeId ? [w.basicEventTypeId] : [];
  const rows = await db.select({ id: workflowEventTypes.eventTypeId }).from(workflowEventTypes).where(eq(workflowEventTypes.workflowId, w.id));
  return rows.map((r) => r.id);
}

/** Runs one page of a backfill (see the file header). */
export async function runBackfill(raw: unknown, ctx: Pick<JobContext, "db">): Promise<{ result: BackfillOutcome }> {
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) throw new PermanentJobError("Malformed workflows.backfill payload");
  const p = parsed.data;
  const db = ctx.db;
  const empty = (skipped: string): { result: BackfillOutcome } => ({ result: { scheduled: 0, revived: 0, meetings: 0, nextPage: false, skipped } });

  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, p.workflowId)).limit(1);
  if (!workflow || workflow.deletedAt) return empty("deleted");
  if (!workflow.active) return empty("off");
  if (!isTimedTrigger(workflow.trigger)) return empty("event_trigger");
  const steps = await db.select().from(workflowSteps).where(eq(workflowSteps.workflowId, workflow.id)).orderBy(asc(workflowSteps.position));
  if (!steps.length) return empty("no_steps");
  const covered = await coveredEventTypes(db, workflow);
  const eventTypeIds = p.eventTypeIds?.length ? covered.filter((id) => p.eventTypeIds!.includes(id)) : covered;
  if (!eventTypeIds.length) return empty("no_event_types");

  const at = clockNow();
  const pageSize = p.pageSize ?? BACKFILL_PAGE_SIZE;
  const cursor = p.cursor ? { startAt: new Date(p.cursor.startAt), inviteeId: p.cursor.inviteeId } : null;
  const page = await db
    .select({
      inviteeId: invitees.id,
      inviteeStatus: invitees.status,
      inviteeCreatedAt: invitees.createdAt,
      meeting: {
        id: scheduledEvents.id,
        organizationId: scheduledEvents.organizationId,
        eventTypeId: scheduledEvents.eventTypeId,
        startAt: scheduledEvents.startAt,
        endAt: scheduledEvents.endAt,
        isGroup: scheduledEvents.isGroup,
        status: scheduledEvents.status,
        pollId: scheduledEvents.pollId,
        oneOffMeetingId: scheduledEvents.oneOffMeetingId,
      },
    })
    .from(invitees)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, invitees.scheduledEventId))
    .where(
      and(
        eq(scheduledEvents.organizationId, workflow.organizationId),
        inArray(scheduledEvents.eventTypeId, eventTypeIds),
        eq(scheduledEvents.status, "active"),
        eq(invitees.status, "active"),
        gt(scheduledEvents.startAt, at),
        isNull(scheduledEvents.pollId),
        isNull(scheduledEvents.oneOffMeetingId),
        cursor
          ? or(
              gt(scheduledEvents.startAt, cursor.startAt),
              and(eq(scheduledEvents.startAt, cursor.startAt), gt(invitees.id, cursor.inviteeId)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(scheduledEvents.startAt), asc(invitees.id))
    .limit(pageSize);

  const byMeeting = new Map<string, { meeting: MeetingForEngine; invitees: EngineInvitee[] }>();
  for (const r of page) {
    let entry = byMeeting.get(r.meeting.id);
    if (!entry) {
      entry = { meeting: { ...r.meeting }, invitees: [] };
      byMeeting.set(r.meeting.id, entry);
    }
    entry.invitees.push({ id: r.inviteeId, status: r.inviteeStatus, createdAt: r.inviteeCreatedAt });
  }
  const ew = engineWorkflow(workflow);
  const es = engineSteps(steps);
  const rows: ExecutionInsert[] = [];
  for (const { meeting, invitees: list } of byMeeting.values()) {
    for (const c of computeExecutions(ew, es, meeting, list, workflow.trigger, { now: at, backfill: true })) {
      rows.push({ ...c, workflowId: workflow.id, scheduledEventId: meeting.id });
    }
  }

  const last = page.at(-1);
  const nextPage = page.length === pageSize && Boolean(last);
  const written = await db.transaction(async (tx) => {
    const result = await upsertExecutions(tx, rows, { reviveReasons: REVIVABLE_REASONS });
    if (nextPage && last) {
      const rootKey = p.rootKey ?? backfillKey(workflow.id, workflow.updatedAt);
      await enqueueJob(tx, {
        type: BACKFILL_JOB,
        payload: {
          workflowId: workflow.id,
          ...(p.eventTypeIds ? { eventTypeIds: p.eventTypeIds } : {}),
          rootKey,
          cursor: { startAt: last.meeting.startAt.toISOString(), inviteeId: last.inviteeId },
          ...(p.pageSize ? { pageSize: p.pageSize } : {}),
        },
        priority: BACKFILL_JOB_PRIORITY,
        idempotencyKey: `${rootKey}:${last.meeting.startAt.getTime()}:${last.inviteeId}`,
      });
    }
    return result.written;
  });
  return {
    result: {
      scheduled: written.filter((w) => w.status === "scheduled" && !w.revived).length,
      revived: written.filter((w) => w.revived).length,
      meetings: byMeeting.size,
      nextPage,
    },
  };
}
