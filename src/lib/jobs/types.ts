// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Job types shared by the runner, the registry and every module jobs.ts file (ARCHITECTURE section 12.2). No runtime
// dependencies besides the two error classes, so module jobs files can import from here without import cycles.
import type { DB } from "@/db";
import type { Logger } from "../logger";

export type JobContext = {
  db: DB;
  jobId: string;
  attempt: number;
  now: Date;
  log: Logger;
  /** Job type being run (set by the runner). */
  type?: string;
  /** Aborted when the job exceeds its time limit; pass it to fetch() and long loops (set by the runner). */
  signal?: AbortSignal;
};

// Payloads are whatever the enqueuer wrote (validated by each handler).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobHandler = (payload: any, ctx: JobContext) => Promise<void | { result?: unknown }>;

/** A job type the runner schedules once per time bucket (idempotency key periodic:{type}:{floor(now/everyMinutes)}). */
export type PeriodicJob = { type: string; everyMinutes: number };

/** Shape of every module jobs file: `export const handlers: JobHandlers = {}` and `export const periodic: PeriodicJob[] = []`. */
export type JobHandlers = Record<string, JobHandler>;

export type EnqueueJobInput = {
  type: string;
  payload?: object;
  /** Defaults to now() (fake time aware); the database default is never used. */
  runAt?: Date;
  priority?: number;
  /** Deduplicates: a second enqueue with the same key returns null. */
  idempotencyKey?: string;
  /** Lets cancelJobs({ groupKey }) cancel related pending jobs (for example wf:{inviteeId}). */
  groupKey?: string;
  maxAttempts?: number;
};

export type CancelJobsFilter = { groupKey?: string; type?: string; ids?: string[] };

export type RunDueJobsOptions = {
  /** Wall clock budget: no new job is claimed after it runs out (the running job finishes). */
  budgetMs: number;
  maxJobs?: number;
  /** Job types to run; a trailing "*" matches a prefix ("event:booking.created:*"). */
  types?: string[];
  /** Only jobs with one of these group keys (after() runs for the jobs a request just enqueued). */
  groupKeys?: string[];
  /** Only these job ids. */
  ids?: string[];
  workerId?: string;
};

export type RunDueJobsResult = { ran: number; succeeded: number; failed: number; remaining: number };

/** Reschedules the job after delayMs without counting the attempt (more than once per hour counts). */
export class RetryLaterError extends Error {
  delayMs: number;
  constructor(delayMs: number, message?: string) {
    super(message);
    this.name = "RetryLaterError";
    this.delayMs = delayMs;
  }
}

/** Marks the job dead without retrying. */
export class PermanentJobError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}
