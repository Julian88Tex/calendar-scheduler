// Runtime migrations in getDb() on real Postgres (ARCHITECTURE 5.1):
// - a cold start against an empty database migrates through the unpooled URL;
// - an up-to-date cold start never opens the unpooled client (an unreachable DATABASE_URL_UNPOOLED is not touched);
// - a Vercel preview without MIGRATE_ON_PREVIEW=1 never migrates and reports the schema as behind.
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, dbKind, getDb, isSchemaBehind } from "@/db";
import { firstRow } from "@/db/helpers";
import { createTestDb } from "../helpers/db";

const KEYS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "VERCEL", "VERCEL_ENV", "MIGRATE_ON_PREVIEW"] as const;
const env = process.env as Record<string, string | undefined>;

afterEach(async () => {
  await closeDb();
  for (const k of KEYS) delete env[k];
});

async function migrationCount(): Promise<number> {
  const db = await getDb();
  const exists = firstRow<{ t: string | null }>(await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`));
  if (!exists?.t) return 0;
  const row = firstRow<{ n: string | number }>(await db.execute(sql`select count(*) as n from drizzle.__drizzle_migrations`));
  return Number(row?.n ?? 0);
}

describe.runIf(process.env.TEST_DATABASE_URL)("getDb runtime migrations (real Postgres)", () => {
  it("migrates on the first cold start and skips the unpooled client when up to date", async () => {
    const t = await createTestDb({ migrate: false, setGlobal: false, kind: "postgres" });
    try {
      env.DATABASE_URL = t.url;
      env.DATABASE_URL_UNPOOLED = t.url;
      await getDb();
      expect(dbKind()).toBe("postgres");
      expect(await migrationCount()).toBeGreaterThanOrEqual(2);
      await closeDb();

      // Up to date: the unpooled URL points nowhere, yet the cold start succeeds because it is never opened.
      env.DATABASE_URL_UNPOOLED = "postgres://nobody:nothing@127.0.0.1:1/none";
      const db = await getDb();
      const row = firstRow<{ ok: number }>(await db.execute(sql`select 1 as ok`));
      expect(Number(row?.ok)).toBe(1);
      expect(isSchemaBehind()).toBe(false);
    } finally {
      await closeDb();
      await t.close();
    }
  });

  it("a Vercel preview without MIGRATE_ON_PREVIEW never migrates and flags the schema as behind", async () => {
    const t = await createTestDb({ migrate: false, setGlobal: false, kind: "postgres" });
    try {
      env.DATABASE_URL = t.url;
      env.VERCEL = "1";
      env.VERCEL_ENV = "preview";
      await getDb();
      expect(isSchemaBehind()).toBe(true);
      expect(await migrationCount()).toBe(0);
      await closeDb();

      env.MIGRATE_ON_PREVIEW = "1";
      await getDb();
      expect(isSchemaBehind()).toBe(false);
      expect(await migrationCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await closeDb();
      await t.close();
    }
  });
});
