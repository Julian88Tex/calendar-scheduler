// POST /api/test/seed { scenario: "owner" | "team" | "empty", demo?: boolean } (E2E only, ARCHITECTURE section 24.2):
// runs a scenario of scripts/seed-scenarios.ts (the same code as `npm run db:seed`) against the server's database and
// answers { ok: true, scenario, demo, owner?, team?, demoData? } with the seeded ids. Idempotent (re-seeding updates in
// place); call /api/test/reset first for a clean database. Business times (demo meetings) follow the fake clock.
import { getDb } from "@/db";
import { isSeedScenario, runSeed } from "../../../../../scripts/seed-scenarios.ts";
import { readJson, testJson, withTestGuard } from "../_lib/guard";

export const dynamic = "force-dynamic";

export const POST = withTestGuard(async (request) => {
  const body = await readJson<{ scenario?: unknown; demo?: unknown }>(request);
  const scenario = body.scenario ?? "owner";
  if (!isSeedScenario(scenario)) {
    return testJson(
      { error: "validation", message: `Unknown scenario "${String(scenario)}" (owner, team, empty)` },
      { status: 400 },
    );
  }
  const db = await getDb();
  const result = await runSeed(db, { scenario, demo: body.demo === true });
  return testJson({ ok: true, ...result });
});
