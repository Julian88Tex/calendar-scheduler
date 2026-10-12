// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Self-hosted in-process job poller (ARCHITECTURE section 12.3): when not on Vercel, in the Node runtime, outside tests
// and outside E2E mode, runDueJobs({ budgetMs: 20000 }) every JOBS_POLL_INTERVAL_SECONDS (default 30).
// Foundation stub: the poller is off (register is a no-op); foundation-platform turns it on.
export async function register(): Promise<void> {
  // Intentionally empty in the foundation stub.
}
