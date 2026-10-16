// Test databases (ARCHITECTURE section 24.1).
//
// createTestDb(): a fresh, migrated database per test file.
// - default: an in-memory PGlite with btree_gist (single backend: transactions serialize, advisory locks are
//   re-entrant, so PGlite can NOT prove race safety; use *.pg.test.ts for that). Migrated databases start from a
//   cached snapshot of a freshly migrated data dir (.cache/pglite-template-<hash>.tar, keyed by the migrations and the
//   PGlite version), which skips initdb and the DDL: about 1 second per file instead of 4.
// - TEST_DATABASE_URL set (npm run test:pg, CI): a new database `test_{random}` on that server, created with
//   CREATE DATABASE, migrated, and dropped by close(); a postgres.js pool of 10 connections.
// By default the module-level getDb() is pointed at the test database (setDbForTests), so services that call getDb()
// use it too. Vitest only (registers hooks).
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { MigrationMeta } from "drizzle-orm/migrator";
import { afterAll, beforeAll } from "vitest";
import { normalizePgUrl, schema, setDbForTests, type DB } from "../../src/db/index.ts";
import { loadMigrations, migrateGuarded } from "../../src/db/migrate.ts";

export type TestDb = {
  db: DB;
  kind: "pglite" | "postgres";
  /** Connection URL of the per-file database (postgres only). */
  url?: string;
  /** Opens an extra, independent postgres.js pool on the same database (race tests); closed by close(). */
  connect: (max?: number) => Promise<DB>;
  close: () => Promise<void>;
};

export type CreateTestDbOptions = {
  /** Apply drizzle/ migrations (default true). */
  migrate?: boolean;
  /** Point getDb() at this database (default true). */
  setGlobal?: boolean;
  /** Force a driver regardless of TEST_DATABASE_URL. */
  kind?: "pglite" | "postgres";
  /** Pool size for postgres (default 10). */
  poolSize?: number;
};

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

let cachedMigrations: MigrationMeta[] | null = null;
/** Bundled migrations, read once per test file. */
export function testMigrations(): MigrationMeta[] {
  cachedMigrations ??= loadMigrations(MIGRATIONS_FOLDER);
  return cachedMigrations;
}

/** True when a real Postgres server is available for this run. */
export const hasPostgres = (): boolean => Boolean(process.env.TEST_DATABASE_URL);

/** Path of the migrated PGlite data dir snapshot for the current migrations and PGlite version. */
function templatePath(): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "node_modules", "@electric-sql", "pglite", "package.json"), "utf8"),
  ) as { version: string };
  const key = createHash("sha256")
    .update(pkg.version)
    .update(testMigrations().map((m) => `${m.folderMillis}:${m.hash}`).join("|"))
    .digest("hex")
    .slice(0, 16);
  return path.join(process.cwd(), ".cache", `pglite-template-${key}.tar`);
}

let templateLoad: Promise<Blob | null> | null = null;
/** The migrated snapshot, created by the first test file that needs it (atomic write; safe across workers). */
function migratedTemplate(): Promise<Blob | null> {
  templateLoad ??= (async () => {
    if (process.env.KAIROS_PGLITE_TEMPLATE === "0") return null;
    const file = templatePath();
    try {
      if (fs.existsSync(file)) return new Blob([fs.readFileSync(file)]);
      const { PGlite } = await import("@electric-sql/pglite");
      const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
      const { drizzle } = await import("drizzle-orm/pglite");
      const client = new PGlite({ extensions: { btree_gist } });
      await migrateGuarded(drizzle(client), { migrations: testMigrations() });
      const dump = await client.dumpDataDir("none");
      await client.close();
      const bytes = Buffer.from(await dump.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, file);
      // Drop snapshots of older migration sets (46 MB each).
      for (const f of fs.readdirSync(path.dirname(file))) {
        if (/^pglite-template-[0-9a-f]+\.tar$/.test(f) && path.join(path.dirname(file), f) !== file) {
          fs.rmSync(path.join(path.dirname(file), f), { force: true });
        }
      }
      return new Blob([bytes]);
    } catch {
      return null; // fall back to migrating every database
    }
  })();
  return templateLoad;
}

async function createPgliteTestDb(opts: CreateTestDbOptions): Promise<TestDb> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const { drizzle } = await import("drizzle-orm/pglite");
  const template = opts.migrate === false ? null : await migratedTemplate();
  const client = template
    ? new PGlite({ loadDataDir: template, extensions: { btree_gist } })
    : new PGlite({ extensions: { btree_gist } });
  const db = drizzle(client, { schema }) as unknown as DB;
  // Idempotent: a no-op on the snapshot (already migrated), a full run otherwise.
  if (opts.migrate !== false) await migrateGuarded(db, { migrations: testMigrations() });
  return {
    db,
    kind: "pglite",
    connect: async () => {
      throw new Error("PGlite is a single connection database; use TEST_DATABASE_URL (npm run test:pg) for pools");
    },
    close: async () => {
      await client.close();
    },
  };
}

async function createPostgresTestDb(opts: CreateTestDbOptions): Promise<TestDb> {
  const baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl) throw new Error("TEST_DATABASE_URL is not set");
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const name = `test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(normalizePgUrl(baseUrl), { max: 1, prepare: false, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const u = new URL(normalizePgUrl(baseUrl));
  u.pathname = `/${name}`;
  const url = u.toString();
  const pools: { end: (o?: { timeout?: number }) => Promise<void> }[] = [];
  const open = (max: number): DB => {
    const client = postgres(url, { max, prepare: false, idle_timeout: 20, onnotice: () => {} });
    pools.push(client);
    return drizzle(client, { schema }) as unknown as DB;
  };
  const db = open(opts.poolSize ?? 10);
  if (opts.migrate !== false) await migrateGuarded(db, { migrations: testMigrations() });
  return {
    db,
    kind: "postgres",
    url,
    connect: async (max = 10) => open(max),
    close: async () => {
      await Promise.all(pools.map((p) => p.end({ timeout: 5 }).catch(() => {})));
      const dropper = postgres(normalizePgUrl(baseUrl), { max: 1, prepare: false, onnotice: () => {} });
      try {
        await dropper.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await dropper.end({ timeout: 5 });
      }
    },
  };
}

/** A fresh database for one test file. Call close() in afterAll. */
export async function createTestDb(opts: CreateTestDbOptions = {}): Promise<TestDb> {
  const kind = opts.kind ?? (hasPostgres() ? "postgres" : "pglite");
  const testDb = kind === "postgres" ? await createPostgresTestDb(opts) : await createPgliteTestDb(opts);
  if (opts.setGlobal !== false) setDbForTests(testDb.db);
  const close = testDb.close;
  return {
    ...testDb,
    close: async () => {
      if (opts.setGlobal !== false) setDbForTests(null);
      await close();
    },
  };
}

/** Runs fn with a fresh database and always closes it. */
export async function withTestDb<T>(fn: (t: TestDb) => Promise<T>, opts: CreateTestDbOptions = {}): Promise<T> {
  const t = await createTestDb(opts);
  try {
    return await fn(t);
  } finally {
    await t.close();
  }
}

/**
 * Vitest convenience: creates the database in beforeAll and closes it in afterAll.
 *   const t = useTestDb();  ...  it("x", async () => { await createUser(t.db); });
 */
export function useTestDb(opts: CreateTestDbOptions = {}): TestDb {
  let current: TestDb | null = null;
  const handle = {
    get db() {
      if (!current) throw new Error("useTestDb(): database not ready (use it inside tests or hooks)");
      return current.db;
    },
    get kind() {
      return current?.kind ?? (hasPostgres() ? "postgres" : "pglite");
    },
    get url() {
      return current?.url;
    },
    connect: (max?: number) => {
      if (!current) throw new Error("useTestDb(): database not ready");
      return current.connect(max);
    },
    close: async () => {
      await current?.close();
      current = null;
    },
  } as TestDb;
  beforeAll(async () => {
    current = await createTestDb(opts);
  });
  afterAll(async () => {
    await handle.close();
  });
  return handle;
}

/** Every table of the schema with its SQL name (for truncation and completeness checks). */
export async function listSchemaTables(): Promise<string[]> {
  const { getTableName, is } = await import("drizzle-orm");
  const { PgTable } = await import("drizzle-orm/pg-core");
  return Object.values(schema)
    .filter((v) => is(v, PgTable))
    .map((t) => getTableName(t as InstanceType<typeof PgTable>))
    .sort();
}
