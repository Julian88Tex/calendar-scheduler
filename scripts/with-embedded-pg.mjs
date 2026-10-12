#!/usr/bin/env node
// Runs a command against a throwaway real Postgres server (ARCHITECTURE section 24.1):
//   node scripts/with-embedded-pg.mjs vitest run --project pg
// Starts embedded-postgres (binaries from the npm registry) on a random free port in .data/embedded-pg/<run id>,
// sets TEST_DATABASE_URL for the child command, then stops the server and deletes its files.
// If TEST_DATABASE_URL is already set (CI with a postgres service container), the command runs against it directly.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/with-embedded-pg.mjs <command> [args...]");
  process.exit(2);
}

function run(env) {
  return new Promise((resolve) => {
    const [cmd, ...rest] = args;
    const bin = path.join(process.cwd(), "node_modules", ".bin", cmd);
    const child = spawn(fs.existsSync(bin) ? bin : cmd, rest, { stdio: "inherit", env });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    child.on("error", (err) => {
      console.error(err);
      resolve(1);
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

if (process.env.TEST_DATABASE_URL) {
  console.log("[with-embedded-pg] TEST_DATABASE_URL already set, using it");
  process.exit(await run(process.env));
}

const { default: EmbeddedPostgres } = await import("embedded-postgres");
const port = await freePort();
const runId = `${port}-${process.pid}`;
const baseDir = path.join(process.cwd(), ".data", "embedded-pg");
const databaseDir = path.join(baseDir, runId);
fs.mkdirSync(baseDir, { recursive: true });
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const quiet = process.env.EMBEDDED_PG_VERBOSE !== "1";

const pg = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: "password",
  authMethod: "password",
  persistent: false,
  // Postgres refuses to run as root; as root, run as the system "postgres" user (created only if missing).
  createPostgresUser: isRoot,
  initdbFlags: ["--encoding=UTF8", "--no-sync"],
  postgresFlags: ["-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off", "-c", "max_connections=200"],
  onLog: (m) => {
    if (!quiet) process.stdout.write(`[pg] ${m}`);
  },
  onError: (m) => {
    if (!quiet) process.stderr.write(`[pg] ${String(m)}\n`);
  },
});

let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  try {
    await pg.stop();
  } catch (e) {
    console.error("[with-embedded-pg] stop failed:", e);
  }
  fs.rmSync(databaseDir, { recursive: true, force: true });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    void stop().then(() => process.exit(130));
  });
}

let code = 1;
try {
  const started = Date.now();
  await pg.initialise();
  await pg.start();
  const url = `postgres://postgres:password@127.0.0.1:${port}/postgres`;
  console.log(`[with-embedded-pg] Postgres ready on port ${port} in ${Date.now() - started}ms (${os.platform()})`);
  code = await run({ ...process.env, TEST_DATABASE_URL: url });
} catch (e) {
  console.error("[with-embedded-pg] failed to start embedded Postgres:", e);
  code = 1;
} finally {
  await stop();
}
process.exit(code);
