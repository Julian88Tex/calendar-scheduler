// Jobs runner (SPEC GEN-16, NT-23; ARCHITECTURE sections 12.2 and 12.3): enqueue with run_at from the app clock,
// idempotency, the $now based claim, backoff with jitter, dead letters, RetryLaterError, PermanentJobError, missing
// handlers, stuck job recovery, periodic buckets, filters, time limits, lost leases, the opportunistic runner lease and
// after() triggering. Module jobs files are mocked with test handlers.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { type: string; payload: unknown; attempt: number }[],
  flaky: new Map<string, number>(),
  afterCallbacks: [] as (() => unknown)[],
  afterThrows: false,
}));

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (cb: () => unknown) => {
    if (h.afterThrows) throw new Error("`after` was called outside a request scope");
    h.afterCallbacks.push(cb);
  },
}));

vi.mock("@/lib/booking/jobs", async () => {
  const { PermanentJobError, RetryLaterError } = await import("@/lib/jobs/types");
  return {
    handlers: {
      "booking.t_ok": async (payload: unknown, ctx: { attempt: number }) => {
        h.calls.push({ type: "booking.t_ok", payload, attempt: ctx.attempt });
        return { result: { ok: true } };
      },
      "booking.t_flaky": async (payload: { id: string }, ctx: { attempt: number }) => {
        h.calls.push({ type: "booking.t_flaky", payload, attempt: ctx.attempt });
        const left = h.flaky.get(payload.id) ?? 0;
        if (left > 0) {
          h.flaky.set(payload.id, left - 1);
          throw new Error("killed mid-way");
        }
      },
      "booking.t_fail": async () => {
        throw new Error("always fails");
      },
      "booking.t_permanent": async () => {
        throw new PermanentJobError("bad payload");
      },
      "booking.t_later": async () => {
        throw new RetryLaterError(10 * 60_000, "provider busy");
      },
      "booking.t_spawn": async (_p: unknown, ctx: { db: import("@/db").DB }) => {
        const { enqueueJob } = await import("@/lib/jobs");
        await enqueueJob(ctx.db, { type: "booking.t_ok", payload: { spawned: true } });
      },
      "booking.t_steal": async (_p: unknown, ctx: { db: import("@/db").DB; jobId: string }) => {
        const { jobs: table } = await import("@/db/schema");
        const { eq: eqOp } = await import("drizzle-orm");
        await ctx.db.update(table).set({ lockedBy: "someone-else" }).where(eqOp(table.id, ctx.jobId));
      },
    },
    periodic: [{ type: "booking.t_periodic", everyMinutes: 60 }],
  };
});

// Other modules' jobs files are contracts owned by their modules: isolate the runner from them.
vi.mock("@/lib/admin/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/calendars/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/contacts/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/lifecycle/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/links/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/meetings/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/payments/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/polls/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/settings/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/teams/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/webhooks/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/workflows/jobs", () => ({ handlers: {}, periodic: [] }));

const { jobs, instanceSettings } = await import("@/db/schema");
const jobsLib = await import("@/lib/jobs");
const { claimNextJob, executeJob, recoverStuckJobs } = await import("@/lib/jobs/runner");
const { acquireLease, readLease, releaseLease } = await import("@/lib/jobs/lease");
const { retryDelayMs } = await import("@/lib/jobs/backoff");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");

const { enqueueJob, enqueueJobs, cancelJobs, runDueJobs, retryJobs, runJobsNow, jobQueueStats } = jobsLib;
const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const job = async (id: string) => (await t.db.select().from(jobs).where(eq(jobs.id, id)))[0]!;
const only = (...types: string[]) => ({ budgetMs: 10_000, types });

beforeEach(async () => {
  await t.db.delete(jobs);
  await t.db.delete(instanceSettings);
  h.calls.length = 0;
  h.flaky.clear();
  h.afterCallbacks.length = 0;
  h.afterThrows = false;
});
afterEach(() => {
  resetFakeTime();
  delete env.E2E_TEST_MODE;
  // Per-process throttle state lives on globalThis: do not leak it to other test files of this worker.
  (globalThis as { __kairosJobsLastRun?: number }).__kairosJobsLastRun = 0;
});

describe("enqueue and cancel", () => {
  it("writes run_at from the app clock, validates input and dedupes by idempotency key", async () => {
    setFakeNow("2031-01-01T09:00:00Z");
    const id = await enqueueJob(t.db, { type: "booking.t_ok", idempotencyKey: "once", payload: { a: 1 }, priority: 99_999 });
    expect(await enqueueJob(t.db, { type: "booking.t_ok", idempotencyKey: "once" })).toBeNull();
    const row = await job(id!);
    expect(Math.abs(row.runAt.getTime() - Date.parse("2031-01-01T09:00:00Z"))).toBeLessThan(5_000);
    expect(row.priority).toBe(32_767);
    await expect(enqueueJob(t.db, { type: " " })).rejects.toThrow(/type/);
    await expect(enqueueJob(t.db, { type: "x", runAt: new Date("nope") })).rejects.toThrow(/runAt/);
  });

  it("the same job enqueued twice with the same idempotency key runs once", async () => {
    await enqueueJob(t.db, { type: "booking.t_ok", idempotencyKey: "dup", payload: { n: 1 } });
    await enqueueJob(t.db, { type: "booking.t_ok", idempotencyKey: "dup", payload: { n: 2 } });
    await runDueJobs(only("booking.t_ok"));
    await runDueJobs(only("booking.t_ok"));
    expect(h.calls).toEqual([{ type: "booking.t_ok", payload: { n: 1 }, attempt: 1 }]);
  });

  it("enqueueJobs inserts in one statement and reports duplicates in order", async () => {
    await enqueueJob(t.db, { type: "booking.t_ok", idempotencyKey: "k2" });
    const ids = await enqueueJobs(t.db, [
      { type: "booking.t_ok", idempotencyKey: "k1" },
      { type: "booking.t_ok", idempotencyKey: "k2" },
      { type: "booking.t_ok" },
    ]);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeNull();
    expect(ids[2]).toBeTruthy();
    expect(await enqueueJobs(t.db, [])).toEqual([]);
  });

  it("cancelJobs needs a filter and cancels only pending jobs", async () => {
    const a = await enqueueJob(t.db, { type: "booking.t_ok", groupKey: "wf:a" });
    const b = await enqueueJob(t.db, { type: "booking.t_ok", groupKey: "wf:b" });
    expect(await cancelJobs(t.db, {})).toBe(0);
    expect(await cancelJobs(t.db, { groupKey: "wf:a", type: "booking.t_ok" })).toBe(1);
    expect((await job(a!)).status).toBe("canceled");
    expect((await job(b!)).status).toBe("pending");
  });
});

describe("enqueueOrReviveJob", () => {
  it("inserts, leaves a pending or running job alone, and revives a finished one with a fresh budget", async () => {
    setFakeNow("2031-01-02T09:00:00Z");
    const id = await jobsLib.enqueueOrReviveJob(t.db, { type: "booking.t_ok", idempotencyKey: "rev", payload: { n: 1 }, maxAttempts: 3 });
    expect(id).toBeTruthy();
    // Pending: untouched.
    expect(await jobsLib.enqueueOrReviveJob(t.db, { type: "booking.t_ok", idempotencyKey: "rev", payload: { n: 2 } })).toBeNull();
    expect((await job(id!)).payload).toEqual({ n: 1 });
    // Running: untouched.
    await t.db.update(jobs).set({ status: "running", lockedBy: "w" }).where(eq(jobs.id, id!));
    expect(await jobsLib.enqueueOrReviveJob(t.db, { type: "booking.t_ok", idempotencyKey: "rev", payload: { n: 3 } })).toBeNull();
    // Finished (dead): revived with the new payload, run time and attempt budget.
    await t.db
      .update(jobs)
      .set({ status: "dead", attempts: 3, lockedBy: null, lastError: "boom", finishedAt: new Date("2031-01-02T09:01:00Z") })
      .where(eq(jobs.id, id!));
    const later = new Date("2031-01-02T10:00:00Z");
    expect(await jobsLib.enqueueOrReviveJob(t.db, { type: "booking.t_ok", idempotencyKey: "rev", payload: { n: 4 }, runAt: later, maxAttempts: 5 })).toBe(id);
    expect(await job(id!)).toMatchObject({
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      payload: { n: 4 },
      runAt: later,
      lastError: null,
      finishedAt: null,
    });
    await expect(jobsLib.enqueueOrReviveJob(t.db, { type: "booking.t_ok", idempotencyKey: "" })).rejects.toThrow(/idempotencyKey/);
  });
});

describe("runDueJobs", () => {
  it("a handler killed mid-way is retried with backoff and completes (GEN-16)", async () => {
    setFakeNow("2031-02-01T10:00:00Z");
    h.flaky.set("x", 2);
    const id = await enqueueJob(t.db, { type: "booking.t_flaky", payload: { id: "x" } });
    let r = await runDueJobs(only("booking.*"));
    expect(r).toMatchObject({ ran: 1, succeeded: 0, failed: 1 });
    let row = await job(id!);
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(row.lastError).toContain("killed mid-way");
    const first = row.runAt.getTime() - Date.parse("2031-02-01T10:00:00Z");
    expect(first).toBeGreaterThanOrEqual(30_000);
    expect(first).toBeLessThan(33_000 + 5_000);
    // Not due before its backoff.
    expect((await runDueJobs(only("booking.*"))).ran).toBe(0);
    setFakeNow("2031-02-01T10:00:40Z");
    await runDueJobs(only("booking.*"));
    row = await job(id!);
    expect(row.attempts).toBe(2);
    const second = row.runAt.getTime() - Date.parse("2031-02-01T10:00:40Z");
    expect(second).toBeGreaterThanOrEqual(60_000);
    expect(second).toBeLessThan(66_000 + 5_000);
    setFakeNow("2031-02-01T10:03:00Z");
    r = await runDueJobs(only("booking.*"));
    expect(r.succeeded).toBe(1);
    expect(await job(id!)).toMatchObject({ status: "succeeded", attempts: 3, lastError: null });
    expect(h.calls.map((c) => c.attempt)).toEqual([1, 2, 3]);
  });

  it("marks dead after max_attempts and on PermanentJobError", async () => {
    setFakeNow("2031-03-01T10:00:00Z");
    const fail = await enqueueJob(t.db, { type: "booking.t_fail", maxAttempts: 2 });
    const perm = await enqueueJob(t.db, { type: "booking.t_permanent" });
    await runDueJobs(only("booking.*"));
    expect(await job(perm!)).toMatchObject({ status: "dead", attempts: 1 });
    expect((await job(perm!)).finishedAt).toBeInstanceOf(Date);
    setFakeNow("2031-03-01T11:00:00Z");
    await runDueJobs(only("booking.*"));
    expect(await job(fail!)).toMatchObject({ status: "dead", attempts: 2 });
  });

  it("RetryLaterError does not count an attempt unless the previous one was less than an hour ago", async () => {
    setFakeNow("2031-04-01T10:00:00Z");
    const id = await enqueueJob(t.db, { type: "booking.t_later", maxAttempts: 2 });
    await runDueJobs(only("booking.*"));
    let row = await job(id!);
    expect(row).toMatchObject({ status: "pending", attempts: 0 });
    expect(row.runAt.getTime() - Date.parse("2031-04-01T10:10:00Z")).toBeLessThan(5_000);
    // 10 minutes later: within the hour, so this one counts.
    setFakeNow("2031-04-01T10:10:01Z");
    await runDueJobs(only("booking.*"));
    row = await job(id!);
    expect(row.attempts).toBe(1);
    setFakeNow("2031-04-01T10:20:02Z");
    await runDueJobs(only("booking.*"));
    expect(await job(id!)).toMatchObject({ status: "dead", attempts: 2 });
  });

  it("reschedules jobs without a registered handler one hour later without counting the attempt", async () => {
    setFakeNow("2031-05-01T10:00:00Z");
    const id = await enqueueJob(t.db, { type: "lifecycle.cancel_user_meetings_not_shipped", payload: { userId: "u" } });
    const r = await runDueJobs({ budgetMs: 10_000, types: ["lifecycle.*"] });
    expect(r).toMatchObject({ ran: 1, succeeded: 0, failed: 0 });
    const row = await job(id!);
    expect(row).toMatchObject({ status: "pending", attempts: 0, lastError: "no_handler" });
    expect(Math.abs(row.runAt.getTime() - Date.parse("2031-05-01T11:00:00Z"))).toBeLessThan(5_000);
  });

  it("recovers stuck running jobs (pending, or dead when out of attempts)", async () => {
    setFakeNow("2031-06-01T12:00:00Z");
    const a = await enqueueJob(t.db, { type: "booking.t_ok" });
    const b = await enqueueJob(t.db, { type: "booking.t_ok", maxAttempts: 1 });
    const fresh = await enqueueJob(t.db, { type: "booking.t_ok" });
    await t.db.update(jobs).set({ status: "running", lockedUntil: new Date("2031-06-01T11:58:00Z"), lockedBy: "dead", attempts: 1 }).where(eq(jobs.id, a!));
    await t.db.update(jobs).set({ status: "running", lockedUntil: new Date("2031-06-01T11:58:00Z"), lockedBy: "dead", attempts: 1 }).where(eq(jobs.id, b!));
    await t.db.update(jobs).set({ status: "running", lockedUntil: new Date("2031-06-01T12:01:00Z"), lockedBy: "alive", attempts: 1 }).where(eq(jobs.id, fresh!));
    expect(await recoverStuckJobs(t.db)).toBe(2);
    expect(await job(a!)).toMatchObject({ status: "pending", lockedBy: null });
    expect((await job(a!)).lastError).toContain("lease_expired");
    expect(await job(b!)).toMatchObject({ status: "dead" });
    expect(await job(fresh!)).toMatchObject({ status: "running", lockedBy: "alive" });
    await runDueJobs(only("booking.t_ok"));
    expect(await job(a!)).toMatchObject({ status: "succeeded", attempts: 2 });
  });

  it("schedules periodic jobs once per time bucket", async () => {
    setFakeNow("2031-07-01T12:10:00Z");
    await runDueJobs({ budgetMs: 10_000 });
    await runDueJobs({ budgetMs: 10_000 });
    const periodic = () => t.db.select().from(jobs).where(eq(jobs.type, "booking.t_periodic"));
    expect(await periodic()).toHaveLength(1);
    expect((await periodic())[0]!.idempotencyKey).toBe(`periodic:booking.t_periodic:${Math.floor(Date.parse("2031-07-01T12:10:00Z") / 3_600_000)}`);
    setFakeNow("2031-07-01T13:01:00Z");
    await runDueJobs({ budgetMs: 10_000 });
    expect(await periodic()).toHaveLength(2);
    // The foundation periodic jobs are registered too.
    const types = new Set((await t.db.select({ type: jobs.type }).from(jobs)).map((r) => r.type));
    expect(types).toEqual(new Set(["booking.t_periodic", "system.cleanup", "email.retry", "sms.retry"]));
  });

  it("filters by type prefix, group key and id, respects maxJobs and priority order", async () => {
    const low = await enqueueJob(t.db, { type: "booking.t_ok", payload: { p: "low" }, groupKey: "g1" });
    const high = await enqueueJob(t.db, { type: "booking.t_ok", payload: { p: "high" }, priority: 10, groupKey: "g1" });
    const other = await enqueueJob(t.db, { type: "booking.t_ok", payload: { p: "other" }, groupKey: "g2" });
    expect((await runDueJobs({ budgetMs: 10_000, groupKeys: ["g1"], maxJobs: 1 })).ran).toBe(1);
    expect(h.calls.map((c) => (c.payload as { p: string }).p)).toEqual(["high"]);
    await runDueJobs({ budgetMs: 10_000, ids: [other!] });
    expect(h.calls.map((c) => (c.payload as { p: string }).p)).toEqual(["high", "other"]);
    expect((await job(low!)).status).toBe("pending");
    expect((await job(high!)).status).toBe("succeeded");
    // A zero budget claims nothing.
    expect((await runDueJobs({ budgetMs: 0 })).ran).toBe(0);
  });

  it("enforces the per job time limit and aborts the handler signal", async () => {
    setFakeNow("2031-08-01T10:00:00Z");
    const id = await enqueueJob(t.db, { type: "booking.t_ok" });
    const claimed = await claimNextJob(t.db, "w1");
    expect(claimed?.id).toBe(id);
    let aborted = false;
    const outcome = await executeJob(
      t.db,
      claimed!,
      (_p, ctx) =>
        new Promise((resolve) => {
          ctx.signal?.addEventListener("abort", () => {
            aborted = true;
          });
          setTimeout(resolve, 500);
        }),
      "w1",
      { timeoutMs: 30 },
    );
    expect(outcome).toBe("failed");
    expect(aborted).toBe(true);
    const row = await job(id!);
    expect(row.status).toBe("pending");
    expect(row.lastError).toContain("time limit");
    // A timed out handler may still run: the retry waits at least one lease (2 minutes).
    expect(row.runAt.getTime() - Date.parse("2031-08-01T10:00:00Z")).toBeGreaterThanOrEqual(120_000);
  });

  it("never overwrites a job whose lease was taken over", async () => {
    const id = await enqueueJob(t.db, { type: "booking.t_steal" });
    await runDueJobs(only("booking.t_steal"));
    expect(await job(id!)).toMatchObject({ status: "running", lockedBy: "someone-else" });
  });

  it("jobs enqueued by handlers run in a later pass", async () => {
    await enqueueJob(t.db, { type: "booking.t_spawn" });
    await runDueJobs(only("booking.*"));
    expect(h.calls).toEqual([{ type: "booking.t_ok", payload: { spawned: true }, attempt: 1 }]);
  });
});

describe("admin helpers (ADM-06)", () => {
  it("retry, run now and stats", async () => {
    setFakeNow("2031-09-01T10:00:00Z");
    const dead = await enqueueJob(t.db, { type: "booking.t_permanent" });
    const later = await enqueueJob(t.db, { type: "booking.t_ok", runAt: new Date("2031-09-02T00:00:00Z") });
    await runDueJobs(only("booking.*"));
    expect((await jobQueueStats(t.db)).byStatus).toMatchObject({ dead: 1, pending: 1 });
    expect(await retryJobs(t.db, [dead!])).toBe(1);
    expect(await job(dead!)).toMatchObject({ status: "pending", attempts: 0 });
    expect(await runJobsNow(t.db, [later!])).toBe(1);
    expect((await jobQueueStats(t.db)).due).toBe(2);
    await runDueJobs(only("booking.t_ok"));
    expect((await job(later!)).status).toBe("succeeded");
  });
});

describe("backoff", () => {
  it("30 seconds doubling, capped at 6 hours, with up to 10% added jitter", () => {
    expect(retryDelayMs(1, () => 0)).toBe(30_000);
    expect(retryDelayMs(1, () => 1)).toBe(33_000);
    expect(retryDelayMs(2, () => 0)).toBe(60_000);
    expect(retryDelayMs(8, () => 0)).toBe(30_000 * 128);
    expect(retryDelayMs(20, () => 0)).toBe(6 * 60 * 60 * 1000);
  });
});

describe("leases and the opportunistic runner", () => {
  it("a lease is held until it expires on the app clock", async () => {
    setFakeNow("2031-10-01T10:00:00Z");
    expect(await acquireLease(t.db, "test_lease", 60_000, "a")).toBe(true);
    expect(await acquireLease(t.db, "test_lease", 60_000, "b")).toBe(false);
    expect(await acquireLease(t.db, "test_lease", 60_000, "a")).toBe(true);
    expect((await readLease(t.db, "test_lease"))?.holder).toBe("a");
    setFakeNow("2031-10-01T10:01:01Z");
    expect(await acquireLease(t.db, "test_lease", 60_000, "b")).toBe(true);
    await releaseLease(t.db, "test_lease", "b");
    expect(await acquireLease(t.db, "test_lease", 60_000, "c")).toBe(true);
  });

  it("maybeRunDueJobs is off in E2E mode and holds the global lease", async () => {
    const g = globalThis as { __kairosJobsLastRun?: number };
    env.E2E_TEST_MODE = "1";
    g.__kairosJobsLastRun = 0;
    await enqueueJob(t.db, { type: "booking.t_ok" });
    await jobsLib.maybeRunDueJobs();
    expect(h.calls).toHaveLength(0);
    delete env.E2E_TEST_MODE;
    // Another instance holds the lease: nothing runs.
    await acquireLease(t.db, jobsLib.JOB_RUNNER_LEASE_KEY, 60_000, "other-instance");
    g.__kairosJobsLastRun = 0;
    await jobsLib.maybeRunDueJobs();
    expect(h.calls).toHaveLength(0);
    await t.db.delete(instanceSettings);
    g.__kairosJobsLastRun = 0;
    await jobsLib.maybeRunDueJobs();
    expect(h.calls).toHaveLength(1);
    // Throttled per instance for 60 seconds.
    await enqueueJob(t.db, { type: "booking.t_ok" });
    await jobsLib.maybeRunDueJobs();
    expect(h.calls).toHaveLength(1);
  });
});

describe("runJobsAfterResponse (after())", () => {
  it("schedules the filtered jobs, then other due work, after the response", async () => {
    const mine = await enqueueJob(t.db, { type: "booking.t_ok", payload: { p: "mine" }, groupKey: "req-1" });
    await enqueueJob(t.db, { type: "booking.t_spawn" });
    jobsLib.runJobsAfterResponse({ groupKeys: ["req-1"] });
    expect(h.calls).toHaveLength(0);
    expect(h.afterCallbacks).toHaveLength(1);
    await h.afterCallbacks[0]!();
    expect((await job(mine!)).status).toBe("succeeded");
    expect(h.calls.map((c) => (c.payload as { p?: string; spawned?: boolean }).p ?? "spawned")).toEqual(["mine", "spawned"]);
  });

  it("is a no-op outside a request scope and never throws", async () => {
    h.afterThrows = true;
    expect(() => jobsLib.runJobsAfterResponse({ types: ["booking.*"] })).not.toThrow();
  });
});
