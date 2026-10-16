// Foundation platform in the real Next server (SPEC GEN-16, ARCHITECTURE section 12.3): /api/cron in open mode (no
// CRON_SECRET in E2E) runs due jobs once per minute and throttles extra calls, the job registry with the foundation
// handlers loads in the server runtime, and the runner honors the fake business clock.
import { expect, test } from "../fixtures";

test.describe("foundation platform", () => {
  test.beforeEach(async ({ api }) => {
    await api.reset();
    await api.setTime(null);
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("/api/cron runs due jobs and throttles open mode to once per minute", async ({ request, api }) => {
    await api.setTime("2031-01-10T09:00:00Z");
    const first = await request.get("/api/cron");
    expect(first.status()).toBe(200);
    expect(first.headers()["cache-control"]).toContain("no-store");
    const body = (await first.json()) as { ok: boolean; mode: string; ran: number; failed: number; skipped?: string };
    expect(body).toMatchObject({ ok: true, mode: "open" });
    expect(body.skipped).toBeUndefined();
    // The periodic foundation jobs (system.cleanup, email.retry, sms.retry) were scheduled and ran.
    expect(body.ran).toBeGreaterThanOrEqual(3);

    const second = await request.get("/api/cron");
    expect(second.status()).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, skipped: "throttled", ran: 0 });

    // A minute later (business clock) it runs again; POST works too (QStash schedules POST).
    await api.advanceTime(61_000);
    const third = await request.post("/api/cron");
    expect(third.status()).toBe(200);
    expect(((await third.json()) as { skipped?: string }).skipped).toBeUndefined();
  });

  test("periodic jobs are scheduled once per bucket and follow the fake clock", async ({ api }) => {
    await api.setTime("2031-02-01T12:00:00Z");
    const a = (await api.runJobs()) as { ok: boolean; ran: number };
    expect(a.ok).toBe(true);
    expect(a.ran).toBeGreaterThanOrEqual(3);
    // Same buckets: nothing new to run.
    expect(await api.runJobs()).toMatchObject({ ok: true, ran: 0 });
    // 15 minutes later the email.retry and sms.retry sweeps are due again (system.cleanup is daily).
    await api.advanceTime(15 * 60_000);
    const later = (await api.runJobs()) as { ran: number };
    expect(later.ran).toBeGreaterThanOrEqual(2);
  });
});
