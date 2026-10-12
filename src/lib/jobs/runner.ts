// The job runner (SPEC GEN-16, ARCHITECTURE section 12.2), safe under Vercel serverless and concurrent workers:
//
// - Claim: one statement, `WITH next AS (SELECT id ... WHERE status = 'pending' AND run_at <= $now ORDER BY priority
//   DESC, run_at LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE jobs SET status = 'running', locked_until = $now + 2 min,
//   locked_by = $worker, attempts = attempts + 1 ...`, with $now from the app clock (never the SQL now()), so any
//   number of workers (after(), cron, the poller, the opportunistic runner) can run at once and each job runs once.
//   Claims are one job at a time: a function killed mid-run leaves at most one job behind, recovered when its lease
//   expires (stuck `running` rows go back to pending at the start of every run, or dead when out of attempts).
// - Budget: wall clock (performance.now(), not the fake business clock); no new job is claimed once it runs out.
//   Each handler gets a 90 second limit (below the 2 minute lease) and an AbortSignal.
// - Outcomes: success -> succeeded; error -> pending with backoff (30s doubling, 6h cap, +10% jitter) or dead after
//   max_attempts; PermanentJobError -> dead; RetryLaterError -> pending after its delay without counting the attempt,
//   unless the previous RetryLater was less than an hour ago; no registered handler -> pending one hour later with
//   last_error "no_handler" and the attempt not counted (a module that has not shipped yet).
// - Finalizing updates only touch the row while this worker still holds it (locked_by), so a lease lost to recovery
//   is never overwritten.
// - Periodic jobs: unfiltered runs ensure one pending job per periodic type and time bucket (idempotency key
//   periodic:{type}:{floor(now / everyMinutes)}).
import "server-only";
import { and, asc, count, desc, eq, inArray, like, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { jobs } from "@/db/schema";
import { log } from "../logger";
import { now, nowMs } from "../time/now";
import { retryDelayMs } from "./backoff";
import type { JobRow } from "./queue";
import {
  PermanentJobError,
  RetryLaterError,
  type JobContext,
  type JobHandler,
  type PeriodicJob,
  type RunDueJobsOptions,
  type RunDueJobsResult,
} from "./types";

export const JOB_LOCK_MS = 2 * 60 * 1000;
export const JOB_TIMEOUT_MS = 90 * 1000;
export const NO_HANDLER_DELAY_MS = 60 * 60 * 1000;
/** A RetryLaterError within this window of the previous one counts as an attempt. */
export const RETRY_LATER_FREE_WINDOW_MS = 60 * 60 * 1000;
const MAX_RETRY_LATER_MS = 7 * 24 * 60 * 60 * 1000;
const PERIODIC_MAX_ATTEMPTS = 4;

class JobTimeoutError extends Error {
  constructor(ms: number) {
    super(`Job exceeded its ${Math.round(ms / 1000)} second time limit`);
    this.name = "JobTimeoutError";
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** SQL filter for the runner options (types with trailing "*" prefixes, group keys, ids). */
export function jobFilter(opts: Pick<RunDueJobsOptions, "types" | "groupKeys" | "ids">): SQL | undefined {
  const conds: SQL[] = [];
  if (opts.types?.length) {
    const parts = opts.types
      .filter((t) => typeof t === "string" && t.length > 0)
      .map((t) => (t.endsWith("*") ? like(jobs.type, `${escapeLike(t.slice(0, -1))}%`) : eq(jobs.type, t)));
    if (parts.length) conds.push(parts.length === 1 ? parts[0]! : or(...parts)!);
  }
  if (opts.groupKeys?.length) conds.push(inArray(jobs.groupKey, opts.groupKeys));
  if (opts.ids?.length) conds.push(inArray(jobs.id, opts.ids));
  if (!conds.length) return undefined;
  return conds.length === 1 ? conds[0] : and(...conds);
}

const isFiltered = (opts: RunDueJobsOptions) => Boolean(opts.types?.length || opts.groupKeys?.length || opts.ids?.length);

/** Stuck `running` rows whose lease expired go back to pending (or dead when out of attempts). */
export async function recoverStuckJobs(db: DB, at: Date = now()): Promise<number> {
  const exhausted = sql`${jobs.attempts} >= ${jobs.maxAttempts}`;
  const rows = await db
    .update(jobs)
    .set({
      status: sql`(case when ${exhausted} then 'dead' else 'pending' end)::job_status`,
      finishedAt: sql`(case when ${exhausted} then ${at.toISOString()}::timestamptz else null end)`,
      runAt: at,
      lockedUntil: null,
      lockedBy: null,
      lastError: "lease_expired: the worker stopped before the job finished",
      updatedAt: at,
    })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedUntil, at)))
    .returning({ id: jobs.id, type: jobs.type, status: jobs.status });
  if (rows.length) log.warn("jobs.recovered_stuck", { count: rows.length, types: [...new Set(rows.map((r) => r.type))] });
  return rows.length;
}

/** Ensures one pending job per periodic type and time bucket (one insert statement). */
export async function ensurePeriodicJobs(db: DB, periodic: readonly PeriodicJob[], at: Date = now()): Promise<void> {
  const seen = new Set<string>();
  const values = [];
  for (const p of periodic) {
    if (!p?.type || seen.has(p.type)) continue;
    const every = Math.max(1, Math.trunc(p.everyMinutes));
    seen.add(p.type);
    const bucket = Math.floor(at.getTime() / (every * 60_000));
    values.push({
      type: p.type,
      payload: {},
      runAt: at,
      priority: 0,
      maxAttempts: PERIODIC_MAX_ATTEMPTS,
      idempotencyKey: `periodic:${p.type}:${bucket}`,
    });
  }
  if (!values.length) return;
  await db
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({ target: jobs.idempotencyKey, where: sql`idempotency_key is not null` });
}

/** Claims the next due job for `workerId` (FOR UPDATE SKIP LOCKED), or null when none is due. */
export async function claimNextJob(db: DB, workerId: string, filter?: SQL): Promise<JobRow | null> {
  const at = now();
  const next = db.$with("next_job").as(
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, at), filter))
      .orderBy(desc(jobs.priority), asc(jobs.runAt))
      .limit(1)
      .for("update", { skipLocked: true }),
  );
  const rows = await db
    .with(next)
    .update(jobs)
    .set({
      status: "running",
      lockedUntil: new Date(at.getTime() + JOB_LOCK_MS),
      lockedBy: workerId,
      attempts: sql`${jobs.attempts} + 1`,
      updatedAt: at,
    })
    .from(next)
    .where(eq(jobs.id, next.id))
    .returning();
  const row = rows[0] as (JobRow & { id: string }) | undefined;
  return row ?? null;
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return msg.slice(0, 2000);
}

type Outcome = "succeeded" | "failed" | "dead" | "retry_later" | "no_handler" | "lease_lost";

async function finalize(db: DB, job: JobRow, workerId: string, set: Partial<typeof jobs.$inferInsert>): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ lockedUntil: null, lockedBy: null, updatedAt: now(), ...set })
    .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId), eq(jobs.status, "running")))
    .returning({ id: jobs.id });
  if (!rows.length) log.warn("job.lease_lost", { jobId: job.id, jobType: job.type });
  return rows.length > 0;
}

function runWithTimeout<T>(p: Promise<T>, ms: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new JobTimeoutError(ms));
      reject(new JobTimeoutError(ms));
    }, ms);
  });
  // The handler may settle after the timeout: never leave its rejection unhandled.
  p.catch(() => {});
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

type RetryLaterState = { retryLaterAt?: string; retryLaterCount?: number };

/** Runs one claimed job and records the outcome. */
export async function executeJob(
  db: DB,
  job: JobRow,
  handler: JobHandler | null,
  workerId: string,
  opts: { timeoutMs?: number } = {},
): Promise<Outcome> {
  const jobLog = log.child({ jobId: job.id, jobType: job.type });
  if (!handler) {
    const ok = await finalize(db, job, workerId, {
      status: "pending",
      runAt: new Date(nowMs() + NO_HANDLER_DELAY_MS),
      attempts: Math.max(job.attempts - 1, 0),
      lastError: "no_handler",
    });
    return ok ? "no_handler" : "lease_lost";
  }
  const controller = new AbortController();
  const ctx: JobContext = {
    db,
    jobId: job.id,
    attempt: job.attempts,
    now: now(),
    log: jobLog,
    type: job.type,
    signal: controller.signal,
  };
  const started = performance.now();
  try {
    const out = await runWithTimeout(
      Promise.resolve().then(() => handler(job.payload, ctx)),
      opts.timeoutMs ?? JOB_TIMEOUT_MS,
      controller,
    );
    const result = out && typeof out === "object" && "result" in out ? (out.result ?? null) : null;
    const ok = await finalize(db, job, workerId, { status: "succeeded", finishedAt: now(), lastError: null, result });
    jobLog.debug("job.succeeded", { attempt: job.attempts, ms: Math.round(performance.now() - started) });
    return ok ? "succeeded" : "lease_lost";
  } catch (e) {
    if (e instanceof RetryLaterError) {
      const prev = (job.result ?? null) as RetryLaterState | null;
      const prevAt = prev?.retryLaterAt ? Date.parse(prev.retryLaterAt) : NaN;
      const counts = Number.isFinite(prevAt) && nowMs() - prevAt < RETRY_LATER_FREE_WINDOW_MS;
      const attempts = counts ? job.attempts : Math.max(job.attempts - 1, 0);
      if (counts && attempts >= job.maxAttempts) {
        jobLog.error("job.dead", { error: e, attempt: attempts, reason: "retry_later_exhausted" });
        const ok = await finalize(db, job, workerId, { status: "dead", finishedAt: now(), lastError: errorText(e) });
        return ok ? "dead" : "lease_lost";
      }
      const delay = Math.min(Math.max(Number.isFinite(e.delayMs) ? e.delayMs : 0, 1_000), MAX_RETRY_LATER_MS);
      const ok = await finalize(db, job, workerId, {
        status: "pending",
        runAt: new Date(nowMs() + delay),
        attempts,
        lastError: errorText(e),
        result: { retryLaterAt: now().toISOString(), retryLaterCount: (prev?.retryLaterCount ?? 0) + 1 } satisfies RetryLaterState,
      });
      return ok ? "retry_later" : "lease_lost";
    }
    if (e instanceof PermanentJobError || job.attempts >= job.maxAttempts) {
      jobLog.error("job.dead", { error: e, attempt: job.attempts });
      const ok = await finalize(db, job, workerId, { status: "dead", finishedAt: now(), lastError: errorText(e) });
      return ok ? "dead" : "lease_lost";
    }
    const timedOut = e instanceof JobTimeoutError;
    // A timed out handler may still be running: wait at least one lease before the next try.
    const delay = timedOut ? Math.max(retryDelayMs(job.attempts), JOB_LOCK_MS) : retryDelayMs(job.attempts);
    jobLog.warn("job.failed", { error: e, attempt: job.attempts, retryInMs: delay });
    const ok = await finalize(db, job, workerId, {
      status: "pending",
      runAt: new Date(nowMs() + delay),
      lastError: errorText(e),
    });
    return ok ? "failed" : "lease_lost";
  }
}

function defaultWorkerId(): string {
  return `worker-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Runs due jobs until the budget, maxJobs or the queue runs out (see the file header). */
export async function runDueJobs(opts: RunDueJobsOptions): Promise<RunDueJobsResult> {
  const db = await getDb();
  const registry = await import("./registry");
  const budgetMs = Number.isFinite(opts.budgetMs) ? Math.max(0, opts.budgetMs) : 0;
  const deadline = performance.now() + budgetMs;
  const workerId = opts.workerId ? `${opts.workerId}-${Math.random().toString(36).slice(2, 8)}` : defaultWorkerId();
  const maxJobs = Math.max(0, Math.min(Math.trunc(opts.maxJobs ?? 100), 10_000));
  const filter = jobFilter(opts);

  await recoverStuckJobs(db, now());
  if (!isFiltered(opts)) await ensurePeriodicJobs(db, registry.PERIODIC_JOBS, now());

  let ran = 0;
  let succeeded = 0;
  let failed = 0;
  while (ran < maxJobs && performance.now() < deadline) {
    const job = await claimNextJob(db, workerId, filter);
    if (!job) break;
    ran++;
    const outcome = await executeJob(db, job, registry.getJobHandler(job.type), workerId);
    if (outcome === "succeeded") succeeded++;
    else if (outcome === "failed" || outcome === "dead") failed++;
  }

  const [rem] = await db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, now()), filter));
  return { ran, succeeded, failed, remaining: Number(rem?.n ?? 0) };
}
