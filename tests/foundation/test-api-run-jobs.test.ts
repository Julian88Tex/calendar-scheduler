// POST /api/test/run-jobs (ARCHITECTURE 24.2): guarded like every test route; runs due jobs with runDueJobs.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as runJobsPOST } from "@/app/api/test/run-jobs/route";
import { jobs } from "@/db/schema";
import { enqueueJob } from "@/lib/jobs";
import { useTestDb } from "../helpers/db";

const SECRET = "test-secret-run-jobs-123456";
const env = process.env as Record<string, string | undefined>;
const req = (body: unknown, secret: string | null = SECRET) =>
  new Request("http://localhost:3000/api/test/run-jobs", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-e2e-secret": secret } : {}) },
    body: JSON.stringify(body),
  });

describe("/api/test/run-jobs", () => {
  const t = useTestDb();
  beforeEach(() => {
    env.E2E_TEST_MODE = "1";
    env.E2E_SECRET = SECRET;
    delete env.VERCEL;
  });
  afterEach(() => {
    delete env.E2E_TEST_MODE;
    delete env.E2E_SECRET;
    delete env.VERCEL;
  });

  it("answers 404 without the secret and on Vercel", async () => {
    expect((await runJobsPOST(req({}, null))).status).toBe(404);
    env.VERCEL = "1";
    expect((await runJobsPOST(req({}))).status).toBe(404);
  });

  it("runs due jobs (filtered by type) and reports the counts", async () => {
    const id = await enqueueJob(t.db, { type: "system.cleanup", idempotencyKey: "run-jobs-test" });
    const res = await runJobsPOST(req({ types: ["system.cleanup"] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ran: number; succeeded: number; remaining: number };
    expect(body).toMatchObject({ ok: true, ran: 1, succeeded: 1, remaining: 0 });
    const [row] = await t.db.select().from(jobs).where(eq(jobs.id, id!));
    expect(row?.status).toBe("succeeded");
  });
});
