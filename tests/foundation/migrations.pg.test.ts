// Migrations on a real Postgres server (embedded-postgres via `npm run test:pg`, or TEST_DATABASE_URL in CI):
// apply, idempotent, every schema table exists, concurrent cold starts apply each migration exactly once, and the
// runtime fast path (migrationsBehind) opens no lock when up to date.
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { rowsOf } from "@/db/helpers";
import { migrateGuarded, migrationsBehind } from "@/db/migrate";
import { createTestDb, listSchemaTables, testMigrations } from "../helpers/db";

describe.runIf(process.env.TEST_DATABASE_URL)("migrations (real Postgres)", () => {
  it("applies on a fresh database, is idempotent and creates every table", async () => {
    const t = await createTestDb({ migrate: false, kind: "postgres" });
    try {
      const migrations = testMigrations();
      expect(await migrationsBehind(t.db, migrations)).toBe(true);
      expect(await migrateGuarded(t.db, { migrations })).toBe(migrations.length);
      expect(await migrateGuarded(t.db, { migrations })).toBe(0);
      expect(await migrationsBehind(t.db, migrations)).toBe(false);

      const present = rowsOf<{ table_name: string }>(
        await t.db.execute(
          sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
        ),
      ).map((r) => r.table_name);
      const expected = await listSchemaTables();
      expect(expected).toHaveLength(89);
      for (const name of expected) expect(present).toContain(name);

      const ext = rowsOf<{ extname: string }>(
        await t.db.execute(sql`select extname from pg_extension where extname = 'btree_gist'`),
      );
      expect(ext).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("five concurrent cold starts apply each migration exactly once", async () => {
    const t = await createTestDb({ migrate: false, kind: "postgres" });
    try {
      const migrations = testMigrations();
      const pools = await Promise.all([1, 2, 3, 4, 5].map(() => t.connect(1)));
      const applied = await Promise.all(pools.map((db) => migrateGuarded(db, { migrations })));
      expect(applied.reduce((a, b) => a + b, 0)).toBe(migrations.length);
      const rows = rowsOf<{ n: string | number }>(
        await t.db.execute(sql`select count(*) as n from drizzle.__drizzle_migrations`),
      );
      expect(Number(rows[0].n)).toBe(migrations.length);
    } finally {
      await t.close();
    }
  });
});
