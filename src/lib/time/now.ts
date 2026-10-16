// The business clock (ARCHITECTURE sections 5.2, 24.2 and 26 rule 20).
//
// RULES for every module:
// - Use now() from this file, never `new Date()` or `Date.now()`, for business logic (slot windows, minimum notice,
//   reservation and token expiry, job run times, rate limit windows, session expiry, poll deadlines).
// - Every business-time comparison in SQL receives the instant as a parameter, `$now`, taken from now():
//     .where(lte(jobs.runAt, now()))            // drizzle builders pass a Date parameter
//     sql`... where expires_at > ${now()}`      // raw SQL
//   Never compare with the database clock (`now()`, `current_timestamp` in SQL). defaultNow() is reserved for
//   created_at and updated_at audit columns.
// This lets E2E tests shift time with POST /api/test/time (the offset below), and unit tests freeze it with
// freezeTime() from tests/helpers/fake-providers.ts (fake Date).
//
// Dependency free on purpose: importable from server code, client code, scripts and tests.

type Clock = { offsetMs: number };
const g = globalThis as typeof globalThis & { __kairosClock?: Clock };
const clock = (): Clock => (g.__kairosClock ??= { offsetMs: 0 });

/** Current business time as epoch milliseconds (real time plus the E2E offset, which is 0 outside tests). */
export function nowMs(): number {
  return Date.now() + clock().offsetMs;
}

/** Current business time. */
export function now(): Date {
  return new Date(nowMs());
}

/** The active fake time offset in milliseconds (0 when time is real). */
export function getTimeOffsetMs(): number {
  return clock().offsetMs;
}

/** Fake time may only be set in tests: Vitest (NODE_ENV=test) or E2E mode outside Vercel. */
export function fakeTimeAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL) return false;
  return env.NODE_ENV === "test" || env.E2E_TEST_MODE === "1";
}

/** Sets the offset added to the real clock. Throws outside tests. */
export function setTimeOffsetMs(offsetMs: number): void {
  if (!fakeTimeAllowed()) throw new Error("Fake time is only available in test mode");
  if (!Number.isFinite(offsetMs)) throw new Error("Invalid time offset");
  clock().offsetMs = Math.trunc(offsetMs);
}

/** Makes now() return `instant` at this moment (time keeps flowing from there). Pass null to restore real time. */
export function setFakeNow(instant: Date | string | number | null): void {
  if (instant === null) {
    if (fakeTimeAllowed()) clock().offsetMs = 0;
    return;
  }
  const target = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  if (Number.isNaN(target)) throw new Error("Invalid fake time");
  setTimeOffsetMs(target - Date.now());
}

/** Restores real time. */
export function resetFakeTime(): void {
  clock().offsetMs = 0;
}
