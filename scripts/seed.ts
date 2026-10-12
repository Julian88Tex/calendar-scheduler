// Demo and test seed CLI (SPEC ADM-10, ARCHITECTURE section 23). Never runs automatically.
//
//   npm run db:seed                         owner scenario (Julian Joseph demo account), idempotent
//   npm run db:seed -- --demo               plus demo meetings, contacts and the seedDemo() of workflows, routing
//                                           forms and meeting polls (no-op stubs until their owners implement them)
//   npm run db:seed -- --scenario=team      owner plus 2 members, team "Sales" with round robin and collective types
//   npm run db:seed -- --scenario=empty     only migrations
//
// Runs through tsx with NODE_OPTIONS=--conditions=react-server (so "server-only" resolves to an empty module) and
// may import any src/** module. Uses the same database as the app: DATABASE_URL / POSTGRES_URL, else PGlite at
// PGLITE_DIR or .data/pglite (stop `next dev` first: one process per PGlite directory). The scenarios live in
// scripts/seed-scenarios.ts (shared with POST /api/test/seed) and the data in scripts/seed-data.ts.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { closeDb, getDb } from "../src/db/index.ts";
import { isSeedScenario, runSeed, type SeedOptions, type SeedResult } from "./seed-scenarios.ts";
import { OWNER, TEAM_SCENARIO } from "./seed-data.ts";

export { runSeed, isSeedScenario, seedOwner, seedTeam, seedDemoExtras } from "./seed-scenarios.ts";
export type { SeedOptions, SeedResult, SeedScenario, SeededDemo, SeededOwner, SeededTeam } from "./seed-scenarios.ts";

export const SEED_USAGE = "usage: npm run db:seed -- [--scenario=owner|team|empty] [--demo]";

/** Parses the CLI flags (throws on unknown flags or scenarios). */
export function parseSeedArgs(argv: string[]): SeedOptions & { help: boolean } {
  const opts: SeedOptions & { help: boolean } = { scenario: "owner", demo: false, help: false };
  for (const a of argv) {
    if (a === "--") continue;
    if (a === "--demo") opts.demo = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a.startsWith("--scenario=")) {
      const v = a.slice("--scenario=".length);
      if (!isSeedScenario(v)) throw new Error(`Unknown scenario "${v}" (owner, team, empty)`);
      opts.scenario = v;
    } else throw new Error(`Unknown argument "${a}". ${SEED_USAGE}`);
  }
  return opts;
}

/** Human summary printed by the CLI. */
export function describeSeed(result: SeedResult): string {
  if (result.scenario === "empty") return "scenario empty: nothing seeded (migrations applied)";
  const lines = [`scenario ${result.scenario}${result.demo ? " with demo data" : ""}`];
  if (result.owner) {
    lines.push(
      `owner ${OWNER.name} <${OWNER.email}> (password ${OWNER.password}, local only) at /${result.owner.slug}: event types ${Object.keys(result.owner.eventTypeIds).join(", ")}`,
    );
  }
  if (result.team) {
    lines.push(
      `team ${TEAM_SCENARIO.team.name} at /${result.team.slug}: members ${Object.keys(result.team.memberIds).join(", ")}; event types ${Object.keys(result.team.eventTypeIds).join(", ")}`,
    );
  }
  if (result.demoData) {
    lines.push(
      `demo: ${result.demoData.scheduledEventIds.length} meetings, ${result.demoData.contactIds.length} contacts, seedDemo() of workflows, routing forms and polls`,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (process.env.VERCEL) {
    console.error("[seed] refusing to run on Vercel (the seed is for local and CI databases only)");
    process.exit(1);
  }
  let opts: ReturnType<typeof parseSeedArgs>;
  try {
    opts = parseSeedArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`[seed] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(SEED_USAGE);
    return;
  }
  const db = await getDb(); // migrates PGlite / Postgres on open
  try {
    const result = await runSeed(db, { scenario: opts.scenario, demo: opts.demo });
    console.log(`[seed] done\n${describeSeed(result)}`);
  } finally {
    await closeDb();
  }
}

const isEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href;
if (isEntry) {
  main().catch((e: unknown) => {
    console.error(`[seed] failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(1);
  });
}
