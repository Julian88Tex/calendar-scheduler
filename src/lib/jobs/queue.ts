// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Job queue writes (ARCHITECTURE section 12.2): enqueue (run_at always explicit from the app clock, idempotency keys
// dedupe), cancel, and the admin actions of ADM-06 (retry, run now, counts). No dependency on the runner or the
// registry, so module code and the email and SMS cores can enqueue without import cycles.
import "server-only";
import { and, count, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { jobs } from "@/db/schema";
import { now } from "../time/now";
import type { CancelJobsFilter, EnqueueJobInput } from "./types";

export type JobRow = typeof jobs.$inferSelect;
export type JobStatus = JobRow["status"];

const MAX_PRIORITY = 32_767;

function jobValues(job: EnqueueJobInput) {
  const type = job.type?.trim();
  if (!type) throw new Error("enqueueJob: type is required");
  if (type.length > 200) throw new Error("enqueueJob: type is too long");
  const runAt = job.runAt ?? now();
  if (!(runAt instanceof Date) || Number.isNaN(runAt.getTime())) throw new Error("enqueueJob: invalid runAt");
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  if (typeof payload !== "object" || Array.isArray(payload)) throw new Error("enqueueJob: payload must be an object");
  return {
    type,
    payload,
    runAt,
    priority: Math.max(-MAX_PRIORITY, Math.min(MAX_PRIORITY, Math.trunc(job.priority ?? 0))),
    maxAttempts: Math.max(1, Math.min(100, Math.trunc(job.maxAttempts ?? 8))),
    idempotencyKey: job.idempotencyKey ?? null,
    groupKey: job.groupKey ?? null,
  };
}

/** Inserts a job (run_at always explicit). Returns the job id, or null when the idempotency key already exists. */
export async function enqueueJob(dbOrTx: DbOrTx, job: EnqueueJobInput): Promise<string | null> {
  const values = jobValues(job);
  if (values.idempotencyKey) {
    const rows = await dbOrTx
      .insert(jobs)
      .values(values)
      .onConflictDoNothing({ target: jobs.idempotencyKey, where: sql`idempotency_key is not null` })
      .returning({ id: jobs.id });
    return rows[0]?.id ?? null;
  }
  const rows = await dbOrTx.insert(jobs).values(values).returning({ id: jobs.id });
  return rows[0]?.id ?? null;
}

/**
 * Inserts several jobs in one statement. Returns one entry per input, in order: the new id, or null when that job's
 * idempotency key already existed. Jobs without an idempotency key are always inserted.
 */
export async function enqueueJobs(dbOrTx: DbOrTx, list: EnqueueJobInput[]): Promise<(string | null)[]> {
  if (!list.length) return [];
  const values = list.map(jobValues);
  const rows = await dbOrTx
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({ target: jobs.idempotencyKey, where: sql`idempotency_key is not null` })
    .returning({ id: jobs.id, idempotencyKey: jobs.idempotencyKey });
  const byKey = new Map(rows.filter((r) => r.idempotencyKey).map((r) => [r.idempotencyKey!, r.id]));
  const unkeyed = rows.filter((r) => !r.idempotencyKey).map((r) => r.id);
  let u = 0;
  return values.map((v) => (v.idempotencyKey ? (byKey.get(v.idempotencyKey) ?? null) : (unkeyed[u++] ?? null)));
}

/** Cancels pending jobs matching every given filter field. Returns the number canceled (0 without a filter). */
export async function cancelJobs(dbOrTx: DbOrTx, filter: CancelJobsFilter): Promise<number> {
  const conds: SQL[] = [eq(jobs.status, "pending")];
  if (filter.groupKey) conds.push(eq(jobs.groupKey, filter.groupKey));
  if (filter.type) conds.push(eq(jobs.type, filter.type));
  if (filter.ids) {
    if (!filter.ids.length) return 0;
    conds.push(inArray(jobs.id, filter.ids));
  }
  if (conds.length === 1) return 0;
  const at = now();
  const rows = await dbOrTx
    .update(jobs)
    .set({ status: "canceled", finishedAt: at, updatedAt: at })
    .where(and(...conds))
    .returning({ id: jobs.id });
  return rows.length;
}

/**
 * ADM-06 "Retry": puts dead, failed or canceled jobs back to pending, due now, with a fresh attempt budget.
 * Returns the number of jobs requeued.
 */
export async function retryJobs(dbOrTx: DbOrTx, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const at = now();
  const rows = await dbOrTx
    .update(jobs)
    .set({ status: "pending", runAt: at, attempts: 0, finishedAt: null, lockedBy: null, lockedUntil: null, updatedAt: at })
    .where(and(inArray(jobs.id, ids), inArray(jobs.status, ["dead", "failed", "canceled"])))
    .returning({ id: jobs.id });
  return rows.length;
}

/** ADM-06 "Run now": makes pending jobs due immediately. Returns the number changed. */
export async function runJobsNow(dbOrTx: DbOrTx, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const at = now();
  const rows = await dbOrTx
    .update(jobs)
    .set({ runAt: at, updatedAt: at })
    .where(and(inArray(jobs.id, ids), eq(jobs.status, "pending")))
    .returning({ id: jobs.id });
  return rows.length;
}

/** Counts by status plus the due backlog (pending with run_at <= now), for the admin overview and jobs page. */
export async function jobQueueStats(dbOrTx: DbOrTx): Promise<{ byStatus: Record<JobStatus, number>; due: number }> {
  const at = now();
  const rows = await dbOrTx.select({ status: jobs.status, n: count() }).from(jobs).groupBy(jobs.status);
  const byStatus: Record<JobStatus, number> = { pending: 0, running: 0, succeeded: 0, failed: 0, canceled: 0, dead: 0 };
  for (const r of rows) byStatus[r.status] = Number(r.n);
  const [due] = await dbOrTx
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, at)));
  return { byStatus, due: Number(due?.n ?? 0) };
}
