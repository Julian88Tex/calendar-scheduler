// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Durable jobs (SPEC GEN-16, ARCHITECTURE section 12.2). Every external side effect is a jobs row written in the same
// transaction as the state change, then run:
//   (a) right after the response: runJobsAfterResponse({ types | groupKeys | ids }) (after(), 8 second budget),
//   (b) on every /api/cron call (250 second budget with CRON_SECRET),
//   (c) opportunistically after dashboard and public page requests: maybeRunDueJobs() (once per minute per instance,
//       plus a DB lease so all instances together run it at most once per minute),
//   (d) every 30 seconds by the self-hosted poller (src/instrumentation.ts; never on Vercel or in E2E mode).
// The runner (runner.ts) claims with FOR UPDATE SKIP LOCKED using the app clock, retries with backoff, marks dead
// letters, recovers stuck jobs and schedules periodic jobs; see that file for the exact rules.
import "server-only";
import { isSetupRequiredError, getDb } from "@/db";
import { log } from "../logger";
import { acquireLease } from "./lease";
import { runDueJobs } from "./runner";

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
export { cancelJobs, enqueueJob, enqueueJobs, jobQueueStats, retryJobs, runJobsNow, type JobRow, type JobStatus } from "./queue";
export { JOB_LOCK_MS, JOB_TIMEOUT_MS, NO_HANDLER_DELAY_MS, runDueJobs } from "./runner";
export { AFTER_RESPONSE_BUDGET_MS, runJobsAfterResponse, runJobsNowInBackground, type RunAfterResponseOptions } from "./after";
export { retryDelayMs } from "./backoff";
export { CRON_STALE_MS, REMINDER_LATE_MS, getCronStatus, reminderDecision, type CronStatus, type ReminderDecision } from "./timing";

/** instance_settings key of the opportunistic runner lease. */
export const JOB_RUNNER_LEASE_KEY = "job_runner_lease";
const OPPORTUNISTIC_INTERVAL_MS = 60_000;

const g = globalThis as typeof globalThis & { __kairosJobsLastRun?: number; __kairosInstanceId?: string };

/** A stable id for this server instance (lease holder names). */
export function instanceId(): string {
  g.__kairosInstanceId ??= `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  return g.__kairosInstanceId;
}

/**
 * Opportunistic run for dashboard layouts and public pages (call it inside after()): at most once per 60 seconds per
 * server instance and, through the job_runner_lease, once per minute across instances; 5 second budget. Never throws.
 * Off in E2E mode, where tests run jobs explicitly through /api/test/run-jobs (deterministic results).
 */
export async function maybeRunDueJobs(): Promise<void> {
  if (process.env.E2E_TEST_MODE === "1") return;
  const t = Date.now();
  if (t - (g.__kairosJobsLastRun ?? 0) < OPPORTUNISTIC_INTERVAL_MS) return;
  g.__kairosJobsLastRun = t;
  try {
    const db = await getDb();
    if (!(await acquireLease(db, JOB_RUNNER_LEASE_KEY, OPPORTUNISTIC_INTERVAL_MS, instanceId()))) return;
    await runDueJobs({ budgetMs: 5_000, maxJobs: 25, workerId: "opportunistic" });
  } catch (e) {
    if (!isSetupRequiredError(e)) log.warn("jobs.opportunistic_run_failed", { error: e });
  }
}
