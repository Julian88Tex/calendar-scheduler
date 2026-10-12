// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Durable jobs (ARCHITECTURE section 12.2). Every external side effect is a jobs row written in the same transaction
// as the state change, run right away through after() and retried by cron.
//
// Foundation stub behavior: enqueueJob and cancelJobs are real; runDueJobs claims due jobs one at a time with the app
// clock ($now from now(), FOR UPDATE SKIP LOCKED), runs them sequentially, retries failures with a simple exponential
// delay, marks dead after max_attempts, recovers stuck jobs, schedules periodic jobs once per bucket and reschedules
// jobs without a registered handler one hour later (last_error 'no_handler'). maybeRunDueJobs is throttled per
// instance (the DB lease is left to foundation-platform). The registry is loaded lazily to avoid import cycles with
// module jobs files that call enqueueJob.
import "server-only";
import { and, asc, count, desc, eq, inArray, like, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DB, type DbOrTx } from "@/db";
import { jobs } from "@/db/schema";
import { log } from "../logger";
import { now, nowMs } from "../time/now";
import {
  PermanentJobError,
  RetryLaterError,
  type CancelJobsFilter,
  type EnqueueJobInput,
  type JobContext,
  type PeriodicJob,
  type RunDueJobsOptions,
  type RunDueJobsResult,
} from "./types";

export {
  PermanentJobError,
  RetryLaterError,
  type CancelJobsFilter,
  type EnqueueJobInput,
  type JobContext,
  type JobHandler,
  type JobHandlers,
  type PeriodicJob,
  type RunDueJobsOptions,
  type RunDueJobsResult,
} from "./types";

export type JobRow = typeof jobs.$inferSelect;

const LOCK_MS = 2 * 60 * 1000;
const NO_HANDLER_DELAY_MS = 60 * 60 * 1000;

/** Inserts a job (run_at always explicit). Returns the job id, or null when the idempotency key already exists. */
export async function enqueueJob(dbOrTx: DbOrTx, job: EnqueueJobInput): Promise<string | null> {
  const values = {
    type: job.type,
    payload: (job.payload ?? {}) as Record<string, unknown>,
    runAt: job.runAt ?? now(),
    priority: job.priority ?? 0,
    maxAttempts: job.maxAttempts ?? 8,
    idempotencyKey: job.idempotencyKey ?? null,
    groupKey: job.groupKey ?? null,
  };
  if (job.idempotencyKey) {
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
  const rows = await dbOrTx
    .update(jobs)
    .set({ status: "canceled", finishedAt: now() })
    .where(and(...conds))
    .returning({ id: jobs.id });
  return rows.length;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

function typeFilter(types: string[] | undefined): SQL | undefined {
  if (!types?.length) return undefined;
  const parts = types.map((t) => (t.endsWith("*") ? like(jobs.type, `${escapeLike(t.slice(0, -1))}%`) : eq(jobs.type, t)));
  return parts.length === 1 ? parts[0] : or(...parts);
}

async function recoverStuckJobs(db: DB, at: Date): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "pending", lockedUntil: null, lockedBy: null })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedUntil, at)));
}

async function ensurePeriodicJobs(db: DB, periodic: readonly PeriodicJob[], at: Date): Promise<void> {
  for (const p of periodic) {
    const bucket = Math.floor(at.getTime() / (p.everyMinutes * 60_000));
    await enqueueJob(db, { type: p.type, runAt: at, idempotencyKey: `periodic:${p.type}:${bucket}` });
  }
}

async function claimNext(db: DB, workerId: string, filter: SQL | undefined): Promise<JobRow | null> {
  return db.transaction(async (tx) => {
    const at = now();
    const due = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, at), filter))
      .orderBy(desc(jobs.priority), asc(jobs.runAt))
      .limit(1)
      .for("update", { skipLocked: true });
    const id = due[0]?.id;
    if (!id) return null;
    const [job] = await tx
      .update(jobs)
      .set({
        status: "running",
        lockedUntil: new Date(at.getTime() + LOCK_MS),
        lockedBy: workerId,
        attempts: sql`${jobs.attempts} + 1`,
      })
      .where(eq(jobs.id, id))
      .returning();
    return job ?? null;
  });
}

function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(attempts - 1, 0), 6 * 60 * 60 * 1000);
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return msg.slice(0, 2000);
}

/** Runs due jobs until the budget, maxJobs or the queue runs out. */
export async function runDueJobs(opts: RunDueJobsOptions): Promise<RunDueJobsResult> {
  const db = await getDb();
  const registry = await import("./registry");
  const startedAt = Date.now(); // the budget is wall clock time, independent of the fake business clock
  const workerId = opts.workerId ?? `worker-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const maxJobs = opts.maxJobs ?? 100;
  const filter = typeFilter(opts.types);

  await recoverStuckJobs(db, now());
  if (!opts.types?.length) await ensurePeriodicJobs(db, registry.PERIODIC_JOBS, now());

  let ran = 0;
  let succeeded = 0;
  let failed = 0;
  while (ran < maxJobs && Date.now() - startedAt < opts.budgetMs) {
    const job = await claimNext(db, workerId, filter);
    if (!job) break;
    ran++;
    const handler = registry.getJobHandler(job.type);
    if (!handler) {
      await db
        .update(jobs)
        .set({
          status: "pending",
          runAt: new Date(nowMs() + NO_HANDLER_DELAY_MS),
          attempts: Math.max(job.attempts - 1, 0),
          lockedUntil: null,
          lockedBy: null,
          lastError: "no_handler",
        })
        .where(eq(jobs.id, job.id));
      continue;
    }
    const ctx: JobContext = {
      db,
      jobId: job.id,
      attempt: job.attempts,
      now: now(),
      log: log.child({ jobId: job.id, jobType: job.type }),
    };
    try {
      const out = await handler(job.payload, ctx);
      await db
        .update(jobs)
        .set({
          status: "succeeded",
          finishedAt: now(),
          lockedUntil: null,
          lockedBy: null,
          lastError: null,
          result: out && typeof out === "object" && "result" in out ? (out.result ?? null) : null,
        })
        .where(eq(jobs.id, job.id));
      succeeded++;
    } catch (e) {
      failed++;
      if (e instanceof RetryLaterError) {
        await db
          .update(jobs)
          .set({
            status: "pending",
            runAt: new Date(nowMs() + Math.max(e.delayMs, 0)),
            attempts: Math.max(job.attempts - 1, 0),
            lockedUntil: null,
            lockedBy: null,
            lastError: errorText(e),
          })
          .where(eq(jobs.id, job.id));
      } else if (e instanceof PermanentJobError || job.attempts >= job.maxAttempts) {
        ctx.log.error("job.dead", { error: e });
        await db
          .update(jobs)
          .set({ status: "dead", finishedAt: now(), lockedUntil: null, lockedBy: null, lastError: errorText(e) })
          .where(eq(jobs.id, job.id));
      } else {
        ctx.log.warn("job.failed", { error: e, attempt: job.attempts });
        await db
          .update(jobs)
          .set({
            status: "pending",
            runAt: new Date(nowMs() + backoffMs(job.attempts)),
            lockedUntil: null,
            lockedBy: null,
            lastError: errorText(e),
          })
          .where(eq(jobs.id, job.id));
      }
    }
  }

  const [rem] = await db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, now()), filter));
  return { ran, succeeded, failed, remaining: Number(rem?.n ?? 0) };
}

const g = globalThis as typeof globalThis & { __kairosJobsLastRun?: number };

/**
 * Opportunistic run for dashboard layouts and public pages (after()): at most once per 60 seconds per server instance.
 * Never throws. Off in E2E mode, where tests run jobs explicitly through /api/test/run-jobs (deterministic results).
 */
export async function maybeRunDueJobs(): Promise<void> {
  if (process.env.E2E_TEST_MODE === "1") return;
  const t = Date.now();
  if (t - (g.__kairosJobsLastRun ?? 0) < 60_000) return;
  g.__kairosJobsLastRun = t;
  try {
    await runDueJobs({ budgetMs: 5_000, maxJobs: 25 });
  } catch (e) {
    log.warn("jobs.opportunistic_run_failed", { error: e });
  }
}
