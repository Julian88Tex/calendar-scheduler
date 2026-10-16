// POST /api/test/run-jobs { types?: string[], maxJobs?: number, budgetMs?: number } (E2E only): runs due jobs now (the
// in-process poller is off in E2E mode, so tests run jobs explicitly). Returns { ran, succeeded, failed, remaining }.
import { runDueJobs } from "@/lib/jobs";
import { readJson, testJson, withTestGuard } from "../_lib/guard";

export const dynamic = "force-dynamic";

export const POST = withTestGuard(async (request) => {
  const body = await readJson<{ types?: unknown; maxJobs?: unknown; budgetMs?: unknown }>(request);
  const types = Array.isArray(body.types) ? body.types.filter((t): t is string => typeof t === "string") : undefined;
  const maxJobs = typeof body.maxJobs === "number" && body.maxJobs > 0 ? Math.floor(body.maxJobs) : 200;
  const budgetMs = typeof body.budgetMs === "number" && body.budgetMs > 0 ? Math.min(body.budgetMs, 60_000) : 30_000;
  const result = await runDueJobs({ budgetMs, maxJobs, types: types?.length ? types : undefined, workerId: "e2e" });
  return testJson({ ok: true, ...result });
});
