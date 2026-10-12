// Workflow persistence (ARCHITECTURE section 14): which live workflows apply to an event type, writing computed
// executions with their workflows.execute jobs, canceling and re-timing pending executions, and the meeting activity
// log. Server only; every function takes the caller's database handle or transaction.
//
// Jobs: one `workflows.execute` job per scheduled execution, keyed `workflows.execute:{executionId}` (revived with
// enqueueOrReviveJob when an execution canceled by unassignment comes back), group key `wf:{inviteeId |
// scheduledEventId}` so lifecycle changes can find them, priority 5 (after event fan-out jobs, before housekeeping).
import "server-only";
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { jobs, meetingActivity, scheduledEvents, workflowEventTypes, workflowExecutions, workflowSteps, workflows } from "@/db/schema";
import { cancelJobs, enqueueJobs, enqueueOrReviveJob } from "@/lib/jobs";
import { now } from "@/lib/time/now";
import { currentRunAt, type ComputedExecution, type EngineStep, type EngineWorkflow, type WorkflowTrigger } from "./engine";

export const EXECUTE_JOB = "workflows.execute";
export const BACKFILL_JOB = "workflows.backfill";
export const EXECUTE_JOB_PRIORITY = 5;
export const BACKFILL_JOB_PRIORITY = 1;

export type WorkflowRow = typeof workflows.$inferSelect;
export type StepRow = typeof workflowSteps.$inferSelect;
export type ExecutionRow = typeof workflowExecutions.$inferSelect;
export type WorkflowWithSteps = { workflow: WorkflowRow; steps: StepRow[] };

/** Skip reasons that backfill and reschedules may undo (ARCHITECTURE section 14). */
export const REVIVABLE_REASONS = ["unassigned", "deactivated"] as const;

export function executeJobKey(executionId: string): string {
  return `${EXECUTE_JOB}:${executionId}`;
}

export function executionGroupKey(e: { inviteeId: string | null; scheduledEventId: string }): string {
  return `wf:${e.inviteeId ?? e.scheduledEventId}`;
}

export function engineWorkflow(w: WorkflowRow): EngineWorkflow {
  return { id: w.id, name: w.name, trigger: w.trigger, offsetMinutes: w.offsetMinutes, isBasic: w.isBasic };
}

export function engineSteps(steps: readonly StepRow[]): EngineStep[] {
  return steps.map((s) => ({
    id: s.id,
    position: s.position,
    action: s.action,
    recipients: s.recipients ?? [],
    subject: s.subject,
    bodyHtml: s.bodyHtml,
    bodyText: s.bodyText,
    includeCancelRescheduleLinks: s.includeCancelRescheduleLinks,
    includeGuests: s.includeGuests,
    replyTo: s.replyTo,
  }));
}

/** SQL condition: the workflow applies to the event type (basic rows directly, others through workflow_event_types). */
function appliesToEventType(eventTypeId: string): SQL {
  return or(
    and(eq(workflows.isBasic, true), eq(workflows.basicEventTypeId, eventTypeId)),
    and(
      eq(workflows.isBasic, false),
      sql`exists (select 1 from ${workflowEventTypes} where ${workflowEventTypes.workflowId} = ${workflows.id} and ${workflowEventTypes.eventTypeId} = ${eventTypeId})`,
    ),
  )!;
}

/** Live (not deleted) workflows with their steps that apply to an event type, in creation order. */
export async function workflowsForEventType(
  db: DbOrTx,
  p: { organizationId: string; eventTypeId: string; triggers?: readonly WorkflowTrigger[]; activeOnly?: boolean; workflowIds?: string[] },
): Promise<WorkflowWithSteps[]> {
  const conds: SQL[] = [eq(workflows.organizationId, p.organizationId), isNull(workflows.deletedAt), appliesToEventType(p.eventTypeId)];
  if (p.activeOnly !== false) conds.push(eq(workflows.active, true));
  if (p.triggers) {
    if (!p.triggers.length) return [];
    conds.push(inArray(workflows.trigger, [...p.triggers]));
  }
  if (p.workflowIds) {
    if (!p.workflowIds.length) return [];
    conds.push(inArray(workflows.id, p.workflowIds));
  }
  // A join (not a single-table select) so the correlated subquery above renders qualified column names.
  const rows = await db
    .select({ workflow: workflows, step: workflowSteps })
    .from(workflows)
    .leftJoin(workflowSteps, eq(workflowSteps.workflowId, workflows.id))
    .where(and(...conds))
    .orderBy(asc(workflows.createdAt), asc(workflows.id), asc(workflowSteps.position));
  const out = new Map<string, WorkflowWithSteps>();
  for (const r of rows) {
    let entry = out.get(r.workflow.id);
    if (!entry) {
      entry = { workflow: r.workflow, steps: [] };
      out.set(r.workflow.id, entry);
    }
    if (r.step) entry.steps.push(r.step);
  }
  return [...out.values()];
}

/** True when the workflow still applies to the event type (send-time re-check). */
export async function workflowAppliesTo(db: DbOrTx, workflow: WorkflowRow, eventTypeId: string): Promise<boolean> {
  if (workflow.isBasic) return workflow.basicEventTypeId === eventTypeId;
  const [row] = await db
    .select({ id: workflowEventTypes.workflowId })
    .from(workflowEventTypes)
    .where(and(eq(workflowEventTypes.workflowId, workflow.id), eq(workflowEventTypes.eventTypeId, eventTypeId)))
    .limit(1);
  return Boolean(row);
}

export type ExecutionInsert = ComputedExecution & { workflowId: string; scheduledEventId: string };

export type UpsertResult = {
  /** Executions written now (new or revived), with their job ids. */
  written: {
    id: string;
    key: string;
    status: "scheduled" | "skipped";
    skipReason: string | null;
    runAt: Date;
    inviteeId: string | null;
    scheduledEventId: string;
    workflowId: string;
    revived: boolean;
    jobId: string | null;
  }[];
};

/**
 * Writes computed executions in one statement: new keys are inserted; an existing key is left alone unless it was
 * canceled with one of `reviveReasons`, in which case it is scheduled again with the new run time and snapshot.
 * Scheduled rows get their workflows.execute job (one bulk insert, revived jobs one by one) and keep the job id.
 */
export async function upsertExecutions(tx: DbOrTx, rows: readonly ExecutionInsert[], opts: { reviveReasons?: readonly string[] } = {}): Promise<UpsertResult> {
  if (!rows.length) return { written: [] };
  const at = now();
  const keys = rows.map((r) => r.idempotencyKey);
  const existing = new Set(
    (
      await tx
        .select({ key: workflowExecutions.idempotencyKey })
        .from(workflowExecutions)
        .where(inArray(workflowExecutions.idempotencyKey, keys))
    ).map((r) => r.key),
  );
  const values = rows.map((r) => ({
    workflowId: r.workflowId,
    stepId: r.stepId,
    scheduledEventId: r.scheduledEventId,
    inviteeId: r.inviteeId,
    trigger: r.trigger,
    runAt: r.runAt,
    status: r.status,
    snapshot: r.snapshot,
    skipReason: r.skipReason,
    idempotencyKey: r.idempotencyKey,
    createdAt: at,
    updatedAt: at,
  }));
  const reasons = [...(opts.reviveReasons ?? [])];
  const insert = tx.insert(workflowExecutions).values(values);
  const returning = {
    id: workflowExecutions.id,
    key: workflowExecutions.idempotencyKey,
    status: workflowExecutions.status,
    skipReason: workflowExecutions.skipReason,
    runAt: workflowExecutions.runAt,
    inviteeId: workflowExecutions.inviteeId,
    scheduledEventId: workflowExecutions.scheduledEventId,
    workflowId: workflowExecutions.workflowId,
  };
  const written = reasons.length
    ? await insert
        .onConflictDoUpdate({
          target: workflowExecutions.idempotencyKey,
          set: {
            status: sql`excluded.status`,
            runAt: sql`excluded.run_at`,
            snapshot: sql`excluded.snapshot`,
            skipReason: sql`excluded.skip_reason`,
            workflowId: sql`excluded.workflow_id`,
            error: null,
            sentAt: null,
            emailOutboxId: null,
            updatedAt: at,
          },
          setWhere: and(eq(workflowExecutions.status, "canceled"), inArray(workflowExecutions.skipReason, reasons)),
        })
        .returning(returning)
    : await insert.onConflictDoNothing({ target: workflowExecutions.idempotencyKey }).returning(returning);

  const scheduledNew = written.filter((w) => w.status === "scheduled" && !existing.has(w.key));
  const scheduledRevived = written.filter((w) => w.status === "scheduled" && existing.has(w.key));
  const jobIds = new Map<string, string | null>();
  const newIds = await enqueueJobs(
    tx,
    scheduledNew.map((w) => ({
      type: EXECUTE_JOB,
      payload: { executionId: w.id },
      runAt: w.runAt,
      priority: EXECUTE_JOB_PRIORITY,
      idempotencyKey: executeJobKey(w.id),
      groupKey: executionGroupKey(w),
    })),
  );
  scheduledNew.forEach((w, i) => jobIds.set(w.id, newIds[i] ?? null));
  for (const w of scheduledRevived) {
    jobIds.set(w.id, await enqueueExecutionJob(tx, { id: w.id, runAt: w.runAt, inviteeId: w.inviteeId, scheduledEventId: w.scheduledEventId }));
  }
  await setJobIds(tx, jobIds);
  return {
    written: written.map((w) => ({
      id: w.id,
      key: w.key,
      status: w.status === "skipped" ? "skipped" : "scheduled",
      skipReason: w.skipReason,
      runAt: w.runAt,
      inviteeId: w.inviteeId,
      scheduledEventId: w.scheduledEventId,
      workflowId: w.workflowId ?? "",
      revived: existing.has(w.key),
      jobId: jobIds.get(w.id) ?? null,
    })),
  };
}

/** Enqueues (or revives) the job of one execution at its run time. */
export async function enqueueExecutionJob(
  tx: DbOrTx,
  e: { id: string; runAt: Date; inviteeId: string | null; scheduledEventId: string },
): Promise<string | null> {
  const id = await enqueueOrReviveJob(tx, {
    type: EXECUTE_JOB,
    payload: { executionId: e.id },
    runAt: e.runAt,
    priority: EXECUTE_JOB_PRIORITY,
    idempotencyKey: executeJobKey(e.id),
    groupKey: executionGroupKey(e),
  });
  if (id) return id;
  // A pending or running job already holds the key: keep pointing at it.
  const [row] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.idempotencyKey, executeJobKey(e.id))).limit(1);
  return row?.id ?? null;
}

async function setJobIds(tx: DbOrTx, ids: Map<string, string | null>): Promise<void> {
  const pairs = [...ids].filter((p): p is [string, string] => Boolean(p[1]));
  if (!pairs.length) return;
  const list = sql.join(
    pairs.map(([executionId, jobId]) => sql`(${executionId}::uuid, ${jobId}::uuid)`),
    sql`, `,
  );
  await tx.execute(
    sql`update workflow_executions set job_id = v.job_id from (values ${list}) as v(id, job_id) where workflow_executions.id = v.id`,
  );
}

/** Pending jobs of these executions (by job id, falling back to the execution job key). */
async function pendingJobIdsFor(tx: DbOrTx, rows: { id: string; jobId: string | null }[]): Promise<string[]> {
  if (!rows.length) return [];
  const keys = rows.map((r) => executeJobKey(r.id));
  const ids = rows.map((r) => r.jobId).filter((x): x is string => Boolean(x));
  const match = ids.length ? or(inArray(jobs.idempotencyKey, keys), inArray(jobs.id, ids)) : inArray(jobs.idempotencyKey, keys);
  const found = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), match));
  return found.map((r) => r.id);
}

/** Cancels scheduled executions matching `where` (and their pending jobs). Returns the canceled ids. */
export async function cancelExecutions(tx: DbOrTx, where: SQL, reason: string): Promise<string[]> {
  const at = now();
  const rows = await tx
    .update(workflowExecutions)
    .set({ status: "canceled", skipReason: reason, updatedAt: at })
    .where(and(eq(workflowExecutions.status, "scheduled"), where))
    .returning({ id: workflowExecutions.id, jobId: workflowExecutions.jobId });
  const jobIds = await pendingJobIdsFor(tx, rows);
  if (jobIds.length) await cancelJobs(tx, { ids: jobIds });
  return rows.map((r) => r.id);
}

/**
 * Moves scheduled timed executions matching `where` to their run time for the meeting's current times (in-place
 * moves, re-seeded demo meetings). A before_start reminder whose new time already passed is skipped
 * (booked_too_close). Returns the number of executions changed.
 */
export async function retimeExecutions(tx: DbOrTx, where: SQL): Promise<number> {
  const at = now();
  const rows = await tx
    .select({ execution: workflowExecutions, startAt: scheduledEvents.startAt, endAt: scheduledEvents.endAt })
    .from(workflowExecutions)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, workflowExecutions.scheduledEventId))
    .where(and(eq(workflowExecutions.status, "scheduled"), where));
  let changed = 0;
  for (const { execution: e, startAt, endAt } of rows) {
    const next = currentRunAt(e.trigger, e.snapshot.offsetMinutes, { startAt, endAt });
    if (!next || next.getTime() === e.runAt.getTime()) continue;
    changed++;
    const jobIds = await pendingJobIdsFor(tx, [{ id: e.id, jobId: e.jobId }]);
    if (jobIds.length) await cancelJobs(tx, { ids: jobIds });
    if (e.trigger === "before_start" && next.getTime() <= at.getTime()) {
      await tx
        .update(workflowExecutions)
        .set({ status: "skipped", skipReason: "booked_too_close", runAt: next, updatedAt: at })
        .where(eq(workflowExecutions.id, e.id));
      continue;
    }
    await tx.update(workflowExecutions).set({ runAt: next, updatedAt: at }).where(eq(workflowExecutions.id, e.id));
    const jobId = await enqueueExecutionJob(tx, { id: e.id, runAt: next, inviteeId: e.inviteeId, scheduledEventId: e.scheduledEventId });
    if (jobId) await tx.update(workflowExecutions).set({ jobId }).where(eq(workflowExecutions.id, e.id));
  }
  return changed;
}

export type ActivityInput = {
  scheduledEventId: string;
  inviteeId: string | null;
  type: "workflow_sent" | "workflow_skipped";
  data: Record<string, unknown>;
};

/** Meeting activity rows (system actor) for workflow sends and skips. */
export async function recordActivity(db: DbOrTx, entries: readonly ActivityInput[]): Promise<void> {
  if (!entries.length) return;
  const at = now();
  await db.insert(meetingActivity).values(
    entries.map((e) => ({
      scheduledEventId: e.scheduledEventId,
      inviteeId: e.inviteeId,
      type: e.type,
      actorType: "system" as const,
      data: e.data,
      createdAt: at,
    })),
  );
}
