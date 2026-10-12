// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Running jobs right after a response (SPEC GEN-16 (a), NT-23; ARCHITECTURE section 12.3).
//
//   await db.transaction(async (tx) => { ...; await publishEvent(tx, "booking.created", payload, meta); });
//   runJobsAfterResponse({ types: ["event:booking.created:*"] });
//
// Uses after() from next/server (Vercel waitUntil), so the jobs the request just enqueued run within seconds without
// delaying the response: first the matching jobs, then, with the rest of the 8 second budget, any other due work
// (follow-ups those handlers enqueued, such as emails). Outside a request scope (scripts, seeds, unit tests) it does
// nothing: cron, the poller or the next request pick the jobs up. Never throws.
import "server-only";
import { after } from "next/server";
import { log } from "../logger";
import { runDueJobs } from "./runner";
import type { RunDueJobsOptions } from "./types";

export const AFTER_RESPONSE_BUDGET_MS = 8_000;

export type RunAfterResponseOptions = Pick<RunDueJobsOptions, "types" | "groupKeys" | "ids"> & {
  budgetMs?: number;
  /** After the matching jobs, keep running other due jobs with the remaining budget (default true). */
  thenAnyDue?: boolean;
};

/** Runs the given jobs now, in the background of the current request (see the file header). */
export async function runJobsNowInBackground(opts: RunAfterResponseOptions = {}): Promise<void> {
  const budgetMs = opts.budgetMs ?? AFTER_RESPONSE_BUDGET_MS;
  const started = performance.now();
  try {
    const filtered = Boolean(opts.types?.length || opts.groupKeys?.length || opts.ids?.length);
    await runDueJobs({ budgetMs, types: opts.types, groupKeys: opts.groupKeys, ids: opts.ids, workerId: "after", maxJobs: 50 });
    const left = budgetMs - (performance.now() - started);
    if (filtered && opts.thenAnyDue !== false && left > 500) {
      await runDueJobs({ budgetMs: left, workerId: "after", maxJobs: 25 });
    }
  } catch (e) {
    log.warn("jobs.after_response_failed", { error: e });
  }
}

/** Schedules runJobsNowInBackground with after(); a no-op outside a request scope. */
export function runJobsAfterResponse(opts: RunAfterResponseOptions = {}): void {
  try {
    after(() => runJobsNowInBackground(opts));
  } catch {
    // Outside a request (scripts, tests): the cron, the poller or the next request run the jobs.
  }
}
