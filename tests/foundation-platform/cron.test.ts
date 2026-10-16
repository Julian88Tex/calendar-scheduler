// GET /api/cron (SPEC GEN-16, ARCHITECTURE section 12.3): CRON_SECRET bearer auth, open mode throttled to once per
// minute across instances (DB lease), last_cron_at written, the route config (maxDuration 300), and the self-hosted
// poller switches in src/instrumentation.ts.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

for (const m of ["admin", "booking", "calendars", "contacts", "lifecycle", "links", "meetings", "payments", "polls", "settings", "teams", "webhooks", "workflows"]) {
  vi.doMock(`@/lib/${m}/jobs`, () => ({ handlers: {}, periodic: [] }));
}

const { instanceSettings, jobs } = await import("@/db/schema");
const route = await import("@/app/api/cron/route");
const { enqueueJob } = await import("@/lib/jobs");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const instrumentation = await import("@/instrumentation");
const poller = await import("@/lib/jobs/poller");
const { useTestDb } = await import("../helpers/db");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const req = (auth?: string, method = "GET") =>
  new Request("http://localhost:3000/api/cron", { method, headers: auth ? { authorization: auth } : {} });
const lastCron = async () => (await t.db.select().from(instanceSettings).where(eq(instanceSettings.key, "last_cron_at")))[0]?.value;

beforeEach(async () => {
  delete env.CRON_SECRET;
  await t.db.delete(instanceSettings);
  await t.db.delete(jobs);
});
afterEach(() => {
  delete env.CRON_SECRET;
  resetFakeTime();
});

describe("/api/cron", () => {
  it("exports the Vercel route config", () => {
    expect(route.maxDuration).toBe(300);
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.POST).toBeTypeOf("function");
  });

  it("with CRON_SECRET: 401 without or with a wrong bearer, runs jobs and writes last_cron_at with it", async () => {
    env.CRON_SECRET = "s3cret-value";
    setFakeNow("2034-01-01T10:00:00Z");
    expect((await route.GET(req())).status).toBe(401);
    expect((await route.GET(req("Bearer nope"))).status).toBe(401);
    expect(await lastCron()).toBeUndefined();
    await enqueueJob(t.db, { type: "system.cleanup", idempotencyKey: "cron-test" });
    const res = await route.GET(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; mode: string; ran: number; succeeded: number };
    expect(body).toMatchObject({ ok: true, mode: "authorized" });
    expect(body.succeeded).toBeGreaterThanOrEqual(1);
    expect(Math.abs(Date.parse(String(await lastCron())) - Date.parse("2034-01-01T10:00:00Z"))).toBeLessThan(5_000);
    // Authorized calls are never throttled.
    expect(((await (await route.GET(req("Bearer s3cret-value"))).json()) as { skipped?: string }).skipped).toBeUndefined();
    expect((await route.POST(req("Bearer s3cret-value", "POST"))).status).toBe(200);
  });

  it("without CRON_SECRET: runs at most once per minute across instances", async () => {
    setFakeNow("2034-02-01T10:00:00Z");
    const first = (await (await route.GET(req())).json()) as { ok: boolean; mode: string; skipped?: string };
    expect(first).toMatchObject({ ok: true, mode: "open" });
    expect(first.skipped).toBeUndefined();
    const stamp = await lastCron();
    expect(stamp).toBeTruthy();
    const second = await route.GET(req());
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, skipped: "throttled", ran: 0 });
    expect(await lastCron()).toEqual(stamp);
    setFakeNow("2034-02-01T10:01:01Z");
    expect(((await (await route.GET(req())).json()) as { skipped?: string }).skipped).toBeUndefined();
    expect(await lastCron()).not.toEqual(stamp);
  });
});

describe("self-hosted poller (src/instrumentation.ts)", () => {
  it("is enabled only in the Node runtime outside Vercel, tests and E2E mode", () => {
    const base = { NEXT_RUNTIME: "nodejs", NODE_ENV: "production" };
    expect(poller.pollerEnabled(base)).toBe(true);
    expect(poller.pollerEnabled({ ...base, E2E_TEST_MODE: "1" })).toBe(false);
    expect(poller.pollerEnabled({ ...base, VERCEL: "1" })).toBe(false);
    expect(poller.pollerEnabled({ ...base, NODE_ENV: "test" })).toBe(false);
    expect(poller.pollerEnabled({ ...base, NEXT_RUNTIME: "edge" })).toBe(false);
    expect(poller.pollerEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(poller.pollerEnabled({ ...base, NEXT_PHASE: "phase-production-build" })).toBe(false);
  });

  it("reads JOBS_POLL_INTERVAL_SECONDS (default 30) and never starts under tests", async () => {
    expect(poller.pollIntervalMs({})).toBe(30_000);
    expect(poller.pollIntervalMs({ JOBS_POLL_INTERVAL_SECONDS: "10" })).toBe(10_000);
    expect(poller.pollIntervalMs({ JOBS_POLL_INTERVAL_SECONDS: "1" })).toBe(30_000);
    const spy = vi.spyOn(globalThis, "setInterval");
    await instrumentation.register();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("starts one poller in a self-hosted Node server and stops cleanly", async () => {
    const saved = { NODE_ENV: env.NODE_ENV, NEXT_RUNTIME: env.NEXT_RUNTIME };
    env.NODE_ENV = "production";
    env.NEXT_RUNTIME = "nodejs";
    const spy = vi.spyOn(globalThis, "setInterval");
    try {
      await instrumentation.register();
      await instrumentation.register();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![1]).toBe(30_000);
    } finally {
      poller.stopJobPoller();
      spy.mockRestore();
      env.NODE_ENV = saved.NODE_ENV;
      if (saved.NEXT_RUNTIME === undefined) delete env.NEXT_RUNTIME;
      else env.NEXT_RUNTIME = saved.NEXT_RUNTIME;
    }
  });
});

describe("delivery timing (NT-23)", () => {
  it("a reminder processed after the meeting start is skipped as too_late; late ones before the start still send", async () => {
    const { reminderDecision, getCronStatus } = await import("@/lib/jobs");
    const start = new Date("2034-03-01T15:00:00Z");
    const due = new Date("2034-03-01T14:45:00Z");
    expect(reminderDecision({ meetingStartAt: start, dueAt: due, at: new Date("2034-03-01T15:00:00Z") })).toMatchObject({ send: false, reason: "too_late" });
    expect(reminderDecision({ meetingStartAt: start, dueAt: due, at: new Date("2034-03-01T14:46:00Z") })).toMatchObject({ send: true, late: false });
    const dayBefore = reminderDecision({ meetingStartAt: start, dueAt: new Date("2034-02-28T15:00:00Z"), at: new Date("2034-03-01T09:00:00Z") });
    expect(dayBefore).toMatchObject({ send: true, late: true });
    // Cron freshness for the admin warning.
    expect((await getCronStatus(t.db)).stale).toBe(true);
    setFakeNow("2034-03-01T10:00:00Z");
    env.CRON_SECRET = "x-secret";
    await route.GET(req("Bearer x-secret"));
    expect(await getCronStatus(t.db)).toMatchObject({ stale: false });
    setFakeNow("2034-03-01T10:16:00Z");
    expect((await getCronStatus(t.db)).stale).toBe(true);
  });
});
