// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Retry timing for jobs (SPEC GEN-16, ARCHITECTURE section 12.2): 30 seconds doubling per attempt, capped at 6 hours,
// with up to 10% jitter added (never subtracted, so a retry never runs before its documented delay) to spread retries
// of jobs that failed together. Pure.

export const RETRY_BASE_MS = 30_000;
export const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
export const RETRY_JITTER = 0.1;

/** Delay before the next try after `attempts` failed attempts (1 = the first failure). */
export function retryDelayMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(RETRY_BASE_MS * 2 ** Math.max(Math.trunc(attempts) - 1, 0), RETRY_MAX_MS);
  const r = Math.min(Math.max(random(), 0), 1);
  return Math.round(base * (1 + RETRY_JITTER * r));
}
