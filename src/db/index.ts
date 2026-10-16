// The database client (tech-reference 3.5, ARCHITECTURE section 5.1): driver switch, singleton, zero config.
//
// - DATABASE_URL or POSTGRES_URL: postgres.js (pooled ok; prepare: false for PgBouncer). On every cold start a fast
//   path compares max(created_at) of drizzle.__drizzle_migrations over the pooled client with the newest bundled
//   migration; only when behind (and shouldMigrate()) does it open the unpooled client and take the migration lock.
// - No URL: PGlite with btree_gist at PGLITE_DIR or .data/pglite (in memory under NODE_ENV=test), loaded with a
//   dynamic import only, migrations applied on open.
// - VERCEL=1 without a URL: SetupRequiredError; PGlite is never touched (its files are excluded from Vercel traces).
//
// No "server-only" import: the seed, scripts and tests load this module directly.
import path from "node:path";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import * as schema from "./schema/index.ts";
import { loadMigrations, migrateGuarded, migrationsBehind, shouldMigrate } from "./migrate.ts";

export { rowsOf, firstRow, pgCode, pgConstraint, isUniqueViolation, withTx } from "./helpers.ts";
export { schema };

export type Schema = typeof schema;
export type Relations = ExtractTablesWithRelations<Schema>;
/** Satisfied by both drivers; db.query.* is fully typed. */
export type DB = PgDatabase<PgQueryResultHKT, Schema, Relations>;
/** A transaction handle (PgTransaction extends PgDatabase, so a Tx can be passed wherever a DB is accepted). */
export type Tx = PgTransaction<PgQueryResultHKT, Schema, Relations>;
export type DbOrTx = DB | Tx;

/** Thrown by getDb() on Vercel when no database URL is configured (pages render the setup page, APIs answer 503). */
export class SetupRequiredError extends Error {
  readonly code = "setup_required" as const;
  readonly status = 503;
  constructor(message = "A Postgres database is required. Connect one in Vercel (Storage tab) and redeploy.") {
    super(message);
    this.name = "SetupRequiredError";
  }
}

export function isSetupRequiredError(e: unknown): e is SetupRequiredError {
  return e instanceof SetupRequiredError || (e as { code?: unknown } | null)?.code === "setup_required";
}

type DbState = {
  db?: Promise<DB>;
  close?: () => Promise<void>;
  kind?: "postgres" | "pglite" | "test";
  schemaBehind?: boolean;
};
// Survives HMR and module duplication (Next dev re-evaluates modules; route bundles may load this file twice).
const g = globalThis as typeof globalThis & { __kairosDb?: DbState };
const state = (): DbState => (g.__kairosDb ??= {});

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Pooled application URL (Neon DATABASE_URL, legacy POSTGRES_URL). */
export const dbUrl = (): string | undefined => process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;

/** Direct (unpooled) URL for migrations, falling back to the pooled URL. */
export const directDbUrl = (): string | undefined =>
  process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || dbUrl();

/** True on Vercel without a database URL: the app must render the setup page and never fall back to PGlite. */
export const setupRequired = (): boolean => process.env.VERCEL === "1" && !dbUrl();

/**
 * postgres.js forwards unknown URL params to the server as GUCs. Neon URLs may contain `channel_binding=require`,
 * which vanilla Postgres rejects (42704 unrecognized configuration parameter).
 */
export function normalizePgUrl(raw: string): string {
  const u = new URL(raw);
  for (const k of ["channel_binding", "gssencmode", "sslcompression"]) u.searchParams.delete(k);
  return u.toString();
}

async function createPostgres(url: string): Promise<DB> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(normalizePgUrl(url), {
    max: 5,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema }) as unknown as DB;
  try {
    const migrations = loadMigrations(MIGRATIONS_FOLDER);
    if (await migrationsBehind(db, migrations)) {
      if (shouldMigrate()) {
        const direct = postgres(normalizePgUrl(directDbUrl() ?? url), { max: 1, prepare: false, onnotice: () => {} });
        try {
          const applied = await migrateGuarded(drizzle(direct), { migrations });
          if (applied > 0) console.info(JSON.stringify({ level: "info", event: "db.migrated", applied }));
        } finally {
          await direct.end({ timeout: 5 });
        }
      } else {
        state().schemaBehind = true;
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "db.schema_behind",
            message: "This preview runs on a database schema older than its code.",
          }),
        );
      }
    }
  } catch (e) {
    await client.end({ timeout: 5 }).catch(() => {});
    throw e;
  }
  state().close = () => client.end({ timeout: 5 });
  state().kind = "postgres";
  return db;
}

async function createPglite(): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const { drizzle } = await import("drizzle-orm/pglite");
  const configured = process.env.PGLITE_DIR;
  const inMemory = configured === "memory://" || (!configured && process.env.NODE_ENV === "test");
  // The data dir is a runtime location, not something to trace into the server bundle (turbopackIgnore).
  const dataDir = inMemory
    ? undefined
    : path.resolve(/*turbopackIgnore: true*/ configured || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "pglite"));
  if (dataDir) (await import("node:fs")).mkdirSync(/*turbopackIgnore: true*/ dataDir, { recursive: true }); // PGlite does NOT mkdir -p
  const client = new PGlite({ dataDir, extensions: { btree_gist } }); // options-object form ONLY
  const db = drizzle(client, { schema }) as unknown as DB;
  try {
    await migrateGuarded(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }
  state().close = () => client.close();
  state().kind = "pglite";
  return db;
}

/** The process-wide database (singleton). Throws SetupRequiredError on Vercel without a database URL. */
export function getDb(): Promise<DB> {
  const s = state();
  if (s.db) return s.db;
  if (setupRequired()) return Promise.reject(new SetupRequiredError());
  const url = dbUrl();
  s.db = (url ? createPostgres(url) : createPglite()).catch((e: unknown) => {
    s.db = undefined;
    throw e;
  });
  return s.db;
}

/** Which driver the singleton uses (null before the first getDb()). */
export function dbKind(): "postgres" | "pglite" | "test" | null {
  return state().kind ?? null;
}

/** True when this deployment's bundled migrations are ahead of the database (preview without MIGRATE_ON_PREVIEW). */
export function isSchemaBehind(): boolean {
  return state().schemaBehind === true;
}

/** Points getDb() at a test database (tests/helpers/db.ts). Pass null to reset the singleton. */
export function setDbForTests(db: DB | null): void {
  const s = state();
  if (db) {
    s.db = Promise.resolve(db);
    s.kind = "test";
    s.close = undefined;
  } else {
    g.__kairosDb = {};
  }
}

/** Closes the singleton's connection (scripts such as the seed call it before exiting). */
export async function closeDb(): Promise<void> {
  const s = state();
  const close = s.close;
  g.__kairosDb = {};
  if (close) await close();
}
