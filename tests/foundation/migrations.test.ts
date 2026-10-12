// Migrations apply on PGlite, are idempotent, cover every schema table, and the schema relations resolve.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { rowsOf } from "@/db/helpers";
import { migrateGuarded, migrationsBehind, newestMigrationMillis } from "@/db/migrate";
import { createTestDb, listSchemaTables, testMigrations, withTestDb } from "../helpers/db";

const initSql = fs.readFileSync(path.join(process.cwd(), "drizzle", "0000_init.sql"), "utf8");

async function publicTables(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string[]> {
  const res = await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  return rowsOf<{ table_name: string }>(res).map((r) => r.table_name);
}

describe("migrations (PGlite)", () => {
  it("every schema table has a CREATE TABLE in the generated migration", async () => {
    const tables = await listSchemaTables();
    expect(tables.length).toBe(89);
    for (const name of tables) expect(initSql).toContain(`CREATE TABLE "${name}"`);
  });

  it("the extension migration enables btree_gist", () => {
    const ext = fs.readFileSync(path.join(process.cwd(), "drizzle", "0001_extensions.sql"), "utf8");
    expect(ext).toMatch(/CREATE EXTENSION IF NOT EXISTS btree_gist/);
    const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.map((e) => e.tag)).toEqual(["0000_init", "0001_extensions"]);
  });

  it("applies every migration, creates every table and is idempotent", async () => {
    await withTestDb(
      async ({ db }) => {
        const migrations = testMigrations();
        expect(await migrationsBehind(db, migrations)).toBe(true); // no journal table yet
        expect(await migrateGuarded(db, { migrations })).toBe(migrations.length);
        expect(await migrationsBehind(db, migrations)).toBe(false);
        expect(await migrateGuarded(db, { migrations })).toBe(0); // idempotent
        expect(await migrateGuarded(db, { migrations })).toBe(0);

        const journal = rowsOf<{ n: string | number; last: string | number }>(
          await db.execute(sql`select count(*) as n, max(created_at) as last from drizzle.__drizzle_migrations`),
        )[0];
        expect(Number(journal.n)).toBe(migrations.length);
        expect(Number(journal.last)).toBe(newestMigrationMillis(migrations));

        const present = await publicTables(db);
        for (const name of await listSchemaTables()) expect(present).toContain(name);

        const ext = rowsOf<{ extname: string }>(
          await db.execute(sql`select extname from pg_extension where extname = 'btree_gist'`),
        );
        expect(ext).toHaveLength(1);
      },
      { migrate: false },
    );
  });

  it("every relation of every table normalizes (one relations() per table, names paired)", async () => {
    const { createTableRelationsHelpers, extractTablesRelationalConfig, normalizeRelation, Relations, is } = await import(
      "drizzle-orm"
    );
    const schema = await import("@/db/schema");
    const relationObjects = Object.values(schema).filter((v) => is(v, Relations));
    const perTable = new Map<string, number>();
    for (const r of relationObjects as InstanceType<typeof Relations>[]) {
      const name = (r.table as unknown as Record<symbol, string>)[Symbol.for("drizzle:Name")];
      perTable.set(name, (perTable.get(name) ?? 0) + 1);
    }
    // A table with two relations() objects would get a union type for `with` (drizzle typing), so forbid it.
    for (const [table, count] of perTable) expect(count, `relations() objects for ${table}`).toBe(1);

    const { tables, tableNamesMap } = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
    let checked = 0;
    for (const table of Object.values(tables)) {
      for (const relation of Object.values(table.relations)) {
        const normalized = normalizeRelation(tables, tableNamesMap, relation);
        expect(normalized.fields.length).toBeGreaterThan(0);
        expect(normalized.references.length).toBe(normalized.fields.length);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(290);
  });

  it("relational queries resolve for every table (relations are consistent)", async () => {
    await withTestDb(async ({ db }) => {
      // Touching every relation of a few hub tables forces drizzle to normalize them.
      await db.query.users.findMany({
        limit: 1,
        with: { sessions: true, handle: true, organizationMemberships: true, ownedEventTypes: true, calendarFeed: true },
      });
      await db.query.eventTypes.findMany({
        limit: 1,
        with: { hosts: { with: { pool: true, schedule: true } }, pools: true, questions: true, poll: true, managedCopies: true },
      });
      await db.query.scheduledEvents.findMany({
        limit: 1,
        with: { hosts: true, invitees: { with: { noShow: true, guests: true, reservation: true } }, rescheduledFrom: true },
      });
      await db.query.bookingReservations.findMany({ limit: 1, with: { invitee: true, payments: true } });
      await db.query.teams.findMany({ limit: 1, with: { handle: true, memberships: true } });
      await db.query.files.findMany({ limit: 1, with: { avatarForUsers: true, logoForUsers: true, owner: true } });
    });
  });
});
