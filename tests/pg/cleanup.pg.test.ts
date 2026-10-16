// system.cleanup on real Postgres through postgres.js (npm run test:pg). Production regression: the retention rules
// compared coalesce(finished_at, created_at) with a JS Date. PGlite serializes the Date, but postgres.js (with
// drizzle's transparent timestamp serializer) received the raw Date object and failed with "The string argument must
// be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date".
// Every retention rule must run, and must delete exactly the rows past their retention window.
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { jobs } from "@/db/schema";
import { getJobHandler } from "@/lib/jobs/registry";
import { runRetentionCleanup } from "@/lib/jobs/cleanup";
import { log } from "@/lib/logger";
import { createTestDb, type TestDb } from "../helpers/db";

const NOW = new Date("2031-03-10T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe.runIf(process.env.TEST_DATABASE_URL)("system.cleanup on real Postgres (postgres.js)", () => {
  let t: TestDb;
  let db: DB;

  beforeAll(async () => {
    t = await createTestDb({ kind: "postgres" });
    db = t.db;
  });
  afterAll(async () => {
    await t?.close();
  });

  it("deletes finished and dead jobs past retention and keeps the rest", async () => {
    const rows = await db
      .insert(jobs)
      .values([
        { type: "test.old_succeeded", status: "succeeded", runAt: ago(30), finishedAt: ago(20), createdAt: ago(30) },
        { type: "test.old_canceled_unfinished", status: "canceled", runAt: ago(30), finishedAt: null, createdAt: ago(30) },
        { type: "test.recent_succeeded", status: "succeeded", runAt: ago(2), finishedAt: ago(1), createdAt: ago(2) },
        { type: "test.old_dead", status: "dead", runAt: ago(120), finishedAt: ago(100), createdAt: ago(120) },
        { type: "test.young_dead", status: "dead", runAt: ago(40), finishedAt: ago(30), createdAt: ago(40) },
        { type: "test.pending", status: "pending", runAt: ago(400), createdAt: ago(400) },
      ])
      .returning({ id: jobs.id, type: jobs.type });
    const result = await runRetentionCleanup(db, NOW, { budgetMs: 20_000 });
    expect(result.complete).toBe(true);
    expect(result.counts.jobs_finished).toBe(2);
    expect(result.counts.jobs_dead).toBe(1);
    const left = await db.select({ type: jobs.type }).from(jobs).where(inArray(jobs.id, rows.map((r) => r.id)));
    expect(left.map((r) => r.type).sort()).toEqual(["test.pending", "test.recent_succeeded", "test.young_dead"]);
  });

  it("the registered system.cleanup handler succeeds", async () => {
    const handler = getJobHandler("system.cleanup");
    expect(handler).toBeTypeOf("function");
    const [job] = await db.insert(jobs).values({ type: "system.cleanup", status: "running", runAt: NOW }).returning();
    const out = await handler!({}, { db, now: NOW, jobId: job!.id, attempt: 1, log } as never);
    expect(out).toMatchObject({ result: { complete: true } });
    await db.delete(jobs).where(eq(jobs.id, job!.id));
  });
});
