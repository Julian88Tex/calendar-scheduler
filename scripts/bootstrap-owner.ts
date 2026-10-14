// Owner bootstrap CLI (docs/DEPLOY.md): the same bootstrapOwner() as POST /api/setup/bootstrap, run straight against
// a database. Use it when you have the production DATABASE_URL at hand (Neon > Connection string) instead of the
// deployed URL and a token.
//
//   DATABASE_URL='postgres://...' NODE_OPTIONS=--import=./scripts/server-only-hook.mjs \
//     npx tsx scripts/bootstrap-owner.ts --email=owner@example.com [--name="Julian Joseph"] [--avatar-url=https://...]
//
// Uses the app's database resolution: DATABASE_URL / POSTGRES_URL, else the local PGlite directory (PGLITE_DIR or
// .data/pglite; stop `next dev` first, one process per PGlite directory). Pending migrations are applied first, as the
// app does on start. OWNER_EMAIL, when set in the environment, must match --email. Idempotent: running it again
// reports what is already there and never overwrites later edits. Exit codes: 0 done, 1 refused or failed, 2 usage.
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DbOrTx } from "@/db";
import { closeDb, dbUrl, getDb } from "../src/db/index.ts";
import { isAppError } from "../src/lib/errors.ts";
import { bootstrapOwner, type BootstrapOwnerResult } from "../src/lib/setup/bootstrap.ts";
import type { BootstrapOwnerInput } from "../src/lib/setup/schemas.ts";

export const BOOTSTRAP_USAGE =
  'usage: npx tsx scripts/bootstrap-owner.ts --email=owner@example.com [--name="Julian Joseph"] [--avatar-url=https://...]';

export type BootstrapCliArgs = BootstrapOwnerInput & { help: boolean };

/** Parses --email, --name and --avatar-url (also as "--flag value"). Throws on unknown or repeated flags. */
export function parseBootstrapArgs(argv: string[]): BootstrapCliArgs {
  const out: BootstrapCliArgs = { email: "", help: false };
  const seen = new Set<string>();
  const flags: Record<string, "email" | "name" | "avatarUrl"> = { "--email": "email", "--name": "name", "--avatar-url": "avatarUrl" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    const eq = arg.indexOf("=");
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const key = flags[flag];
    if (!key) throw new Error(`Unknown argument "${arg}". ${BOOTSTRAP_USAGE}`);
    if (seen.has(flag)) throw new Error(`${flag} was given twice. ${BOOTSTRAP_USAGE}`);
    seen.add(flag);
    let value: string | undefined;
    if (eq > 0) value = arg.slice(eq + 1);
    else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value. ${BOOTSTRAP_USAGE}`);
      i++;
    }
    out[key] = value;
  }
  if (!out.help && !out.email) throw new Error(`--email is required. ${BOOTSTRAP_USAGE}`);
  return out;
}

/** Human summary printed by the CLI. */
export function describeBootstrap(result: BootstrapOwnerResult): string {
  const lines = [
    `${result.account === "created" ? "Created" : "Found"} the owner account ${result.user.email} (${result.user.id}).`,
    ...result.changes.map((c) => `- ${c}`),
  ];
  if (result.snapshot.status === "applied") {
    for (const et of result.snapshot.eventTypes) lines.push(`  ${et.name}: ${et.url}`);
  }
  if (result.links.profile) lines.push(`Booking page: ${result.links.profile}`);
  lines.push(`Next: open ${result.links.login} and choose "Continue with Google" with ${result.user.email}.`);
  return lines.join("\n");
}

/** Runs the bootstrap for parsed CLI arguments and returns the summary (no process exit, no database close). */
export async function runBootstrapCli(args: BootstrapOwnerInput, opts: { db?: DbOrTx } = {}): Promise<{ result: BootstrapOwnerResult; summary: string }> {
  const result = await bootstrapOwner({ email: args.email, name: args.name ?? null, avatarUrl: args.avatarUrl ?? null }, opts);
  return { result, summary: describeBootstrap(result) };
}

function errorText(e: unknown): string {
  if (isAppError(e)) {
    const fields = e.fieldErrors ? Object.entries(e.fieldErrors).map(([k, v]) => `${k}: ${v.join(" ")}`) : [];
    return [`${e.message} (${e.code})`, ...fields].join("\n");
  }
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

async function main(): Promise<void> {
  let args: BootstrapCliArgs;
  try {
    args = parseBootstrapArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`[bootstrap] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  if (args.help) {
    console.log(BOOTSTRAP_USAGE);
    return;
  }
  try {
    await getDb(); // opens (and migrates) the database
    console.log(`[bootstrap] database: ${dbUrl() ? "Postgres from DATABASE_URL / POSTGRES_URL" : `local PGlite at ${process.env.PGLITE_DIR || ".data/pglite"}`}`);
    const { summary } = await runBootstrapCli(args);
    console.log(`[bootstrap] done\n${summary}`);
  } catch (e) {
    console.error(`[bootstrap] refused or failed: ${errorText(e)}`);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

const isEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href;
if (isEntry) {
  main().catch((e: unknown) => {
    console.error(`[bootstrap] failed: ${errorText(e)}`);
    process.exit(1);
  });
}
