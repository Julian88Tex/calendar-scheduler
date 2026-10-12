// Guarded, pooler-safe runtime migrations (tech-reference 3.4, ARCHITECTURE section 5.1).
//
// PLAIN NODE CONSTRAINT: scripts/migrate.ts runs this file under Node 22 type stripping in the Vercel build. Keep the
// imports limited to drizzle packages and node:* built-ins, use relative imports with explicit .ts extensions, never
// import "server-only", and use erasable TypeScript syntax only.
import { sql } from "drizzle-orm";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export type { MigrationMeta };

// Accept any Postgres drizzle database (postgres.js or PGlite, with or without a schema).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPgDatabase = PgDatabase<PgQueryResultHKT, any>;

/** Transaction advisory lock key shared by every migrator instance (build script and runtime). */
export const MIGRATION_LOCK_KEY = 727001;

export type MigrateOptions = { migrationsFolder?: string; migrations?: MigrationMeta[]; lockKey?: number };

const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];

/** Reads the bundled migrations (drizzle/meta/_journal.json plus the SQL files). */
export function loadMigrations(migrationsFolder = "./drizzle"): MigrationMeta[] {
  return readMigrationFiles({ migrationsFolder });
}

/** The newest bundled migration timestamp (journal `when`), or -1 when there are none. */
export function newestMigrationMillis(migrations: MigrationMeta[]): number {
  return migrations.reduce((max, m) => Math.max(max, m.folderMillis), -1);
}

/**
 * Applies pending migrations inside ONE transaction guarded by pg_advisory_xact_lock (released at COMMIT or ROLLBACK,
 * so it is safe behind PgBouncer transaction pooling). Table compatible with Drizzle's own migrator
 * (drizzle.__drizzle_migrations). Returns the number of migrations applied. Idempotent.
 *
 * Caveat: everything runs in one transaction, so a new enum value added by ALTER TYPE ... ADD VALUE cannot be used
 * later in the same batch (expand and contract: use it in the next release).
 */
export async function migrateGuarded(db: AnyPgDatabase, opts: MigrateOptions = {}): Promise<number> {
  const migrations = opts.migrations ?? loadMigrations(opts.migrationsFolder ?? "./drizzle");
  const lockKey = opts.lockKey ?? MIGRATION_LOCK_KEY;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${lockKey})`);
    await tx.execute(sql`create schema if not exists "drizzle"`);
    await tx.execute(
      sql`create table if not exists "drizzle"."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)`,
    );
    const res = await tx.execute(
      sql`select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1`,
    );
    const rows = rowsOf<{ created_at: string | number }>(res);
    const last = rows[0] ? Number(rows[0].created_at) : -1;
    let applied = 0;
    for (const m of migrations) {
      if (m.folderMillis <= last) continue;
      for (const stmt of m.sql) if (stmt.trim()) await tx.execute(sql.raw(stmt));
      await tx.execute(
        sql`insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values (${m.hash}, ${m.folderMillis})`,
      );
      applied++;
    }
    return applied;
  });
}

/**
 * Runtime fast path: true when the database is behind the bundled migrations. Uses only the given (pooled) client and
 * never takes a lock. A missing migrations table counts as behind.
 */
export async function migrationsBehind(db: AnyPgDatabase, migrations: MigrationMeta[]): Promise<boolean> {
  const newest = newestMigrationMillis(migrations);
  if (newest < 0) return false;
  const exists = rowsOf<{ t: string | null }>(
    await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`),
  );
  if (!exists[0]?.t) return true;
  const res = rowsOf<{ last: string | number | null }>(
    await db.execute(sql`select max(created_at) as last from "drizzle"."__drizzle_migrations"`),
  );
  const last = res[0]?.last == null ? -1 : Number(res[0].last);
  return last < newest;
}

/**
 * The one predicate for build time and runtime migrations (ARCHITECTURE 5.1): always locally and when self-hosted
 * (VERCEL_ENV unset); on Vercel only for production deployments, or for previews when MIGRATE_ON_PREVIEW=1 (Neon
 * preview branching gives each preview its own database). Previews otherwise never migrate, because the Neon
 * integration often attaches the production database to previews.
 */
export function shouldMigrate(env: Record<string, string | undefined> = process.env): boolean {
  const vercelEnv = env.VERCEL_ENV;
  if (!vercelEnv) return true;
  if (vercelEnv === "production") return true;
  return env.MIGRATE_ON_PREVIEW === "1";
}
