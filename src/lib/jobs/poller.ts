// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Self-hosted in-process job poller (SPEC GEN-16 (d), ARCHITECTURE section 12.3), started by src/instrumentation.ts in
// the Node runtime: runDueJobs({ budgetMs: 20000 }) every JOBS_POLL_INTERVAL_SECONDS (default 30) when the app runs on
// its own server (`next start` or `next dev`). Never on Vercel (cron and after() trigger jobs there), never under tests
// (NODE_ENV=test), never in E2E mode (E2E_TEST_MODE=1: tests run jobs explicitly through /api/test/run-jobs so
// results are deterministic) and never inside `next build`. Ticks never overlap, the timers do not keep the process
// alive, and a dev server reload does not start a second poller.

type PollerState = {
  timer?: ReturnType<typeof setInterval>;
  boot?: ReturnType<typeof setTimeout>;
  running?: boolean;
  started?: boolean;
};

const g = globalThis as typeof globalThis & { __kairosPoller?: PollerState };

/** True when this process should run the poller (exported for tests). */
export function pollerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NEXT_RUNTIME !== "nodejs") return false;
  if (env.VERCEL) return false;
  if (env.NODE_ENV === "test") return false;
  if (env.E2E_TEST_MODE === "1") return false;
  // `next build` may load instrumentation in its workers: never poll (or open the local database) from a build.
  if (env.NEXT_PHASE === "phase-production-build") return false;
  return true;
}

/** Poll interval in milliseconds from JOBS_POLL_INTERVAL_SECONDS (5 to 3600, default 30). */
export function pollIntervalMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.JOBS_POLL_INTERVAL_SECONDS);
  const seconds = Number.isFinite(raw) && raw >= 5 && raw <= 3600 ? Math.trunc(raw) : 30;
  return seconds * 1000;
}

/** Stops the poller (tests and hot reload). */
export function stopJobPoller(): void {
  const s = g.__kairosPoller;
  if (s?.timer) clearInterval(s.timer);
  if (s?.boot) clearTimeout(s.boot);
  g.__kairosPoller = {};
}

/** Starts the poller once per process when pollerEnabled(); returns whether it is running. */
export function startJobPoller(): boolean {
  if (!pollerEnabled()) return false;
  const state = (g.__kairosPoller ??= {});
  if (state.started) return true;
  state.started = true;
  const interval = pollIntervalMs();
  const tick = async () => {
    if (state.running || g.__kairosPoller !== state) return;
    state.running = true;
    try {
      const { runDueJobs } = await import("./runner");
      await runDueJobs({ budgetMs: 20_000, workerId: "poller" });
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      if (code !== "setup_required") {
        console.warn(JSON.stringify({ level: "warn", event: "jobs.poller_failed", message: e instanceof Error ? e.message : String(e) }));
      }
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(() => void tick(), interval);
  state.timer.unref?.();
  // First run shortly after boot (lets the server finish starting and migrations run on first DB use).
  state.boot = setTimeout(() => void tick(), Math.min(5_000, interval));
  state.boot.unref?.();
  return true;
}
