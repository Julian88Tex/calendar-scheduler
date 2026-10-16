// src/db/index.ts and src/db/migrate.ts decisions: shouldMigrate gating, SetupRequiredError on Vercel without a
// database, URL normalization, the singleton and setDbForTests, the business clock.
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  closeDb,
  dbKind,
  dbUrl,
  directDbUrl,
  getDb,
  isSetupRequiredError,
  normalizePgUrl,
  setDbForTests,
  setupRequired,
  SetupRequiredError,
} from "@/db";
import { firstRow, paginate, toPage } from "@/db/helpers";
import { shouldMigrate } from "@/db/migrate";
import { getTimeOffsetMs, now, resetFakeTime, setFakeNow } from "@/lib/time/now";
import { createTestDb } from "../helpers/db";

const ENV_KEYS = [
  "VERCEL",
  "VERCEL_ENV",
  "MIGRATE_ON_PREVIEW",
  "DATABASE_URL",
  "POSTGRES_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetFakeTime();
  await closeDb();
});

describe("shouldMigrate", () => {
  it("always migrates locally and when self-hosted (VERCEL_ENV unset)", () => {
    expect(shouldMigrate({})).toBe(true);
    expect(shouldMigrate({ NODE_ENV: "production" })).toBe(true);
    expect(shouldMigrate({ MIGRATE_ON_PREVIEW: "0" })).toBe(true);
  });
  it("migrates Vercel production deployments", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(true);
  });
  it("never migrates Vercel previews unless MIGRATE_ON_PREVIEW=1", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe(false);
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: "true" })).toBe(false);
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: "1" })).toBe(true);
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "development" })).toBe(false);
  });
  it("reads process.env by default", () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.MIGRATE_ON_PREVIEW;
    expect(shouldMigrate()).toBe(false);
    process.env.MIGRATE_ON_PREVIEW = "1";
    expect(shouldMigrate()).toBe(true);
  });
});

describe("getDb", () => {
  it("throws SetupRequiredError on Vercel without a database URL and never opens PGlite", async () => {
    process.env.VERCEL = "1";
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    expect(setupRequired()).toBe(true);
    const error = await getDb().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SetupRequiredError);
    expect(isSetupRequiredError(error)).toBe(true);
    expect((error as SetupRequiredError).status).toBe(503);
    expect((error as SetupRequiredError).code).toBe("setup_required");
    expect(dbKind()).toBeNull();
  });

  it("is not in setup mode on Vercel with a URL, or locally without one", () => {
    process.env.VERCEL = "1";
    process.env.DATABASE_URL = "postgres://u:p@db.example.com/app";
    expect(setupRequired()).toBe(false);
    delete process.env.VERCEL;
    delete process.env.DATABASE_URL;
    expect(setupRequired()).toBe(false);
  });

  it("prefers DATABASE_URL, falls back to POSTGRES_URL, and uses the unpooled URL for migrations", () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_URL = "postgres://a/legacy";
    expect(dbUrl()).toBe("postgres://a/legacy");
    process.env.DATABASE_URL = "postgres://a-pooler/app";
    expect(dbUrl()).toBe("postgres://a-pooler/app");
    expect(directDbUrl()).toBe("postgres://a-pooler/app");
    process.env.POSTGRES_URL_NON_POOLING = "postgres://a/direct-legacy";
    expect(directDbUrl()).toBe("postgres://a/direct-legacy");
    process.env.DATABASE_URL_UNPOOLED = "postgres://a/direct";
    expect(directDbUrl()).toBe("postgres://a/direct");
  });

  it("opens an in-memory PGlite under NODE_ENV=test, migrated, as a singleton", async () => {
    delete process.env.VERCEL;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    const a = getDb();
    const b = getDb();
    expect(a).toBe(b);
    const db = await a;
    expect(dbKind()).toBe("pglite");
    const row = firstRow<{ n: string | number }>(await db.execute(sql`select count(*) as n from drizzle.__drizzle_migrations`));
    expect(Number(row?.n)).toBeGreaterThanOrEqual(2);
  });

  it("setDbForTests points getDb at a test database", async () => {
    const t = await createTestDb({ setGlobal: false });
    try {
      setDbForTests(t.db);
      expect(await getDb()).toBe(t.db);
      expect(dbKind()).toBe("test");
      setDbForTests(null);
      expect(dbKind()).toBeNull();
    } finally {
      await t.close();
    }
  });
});

describe("normalizePgUrl", () => {
  it("strips params that vanilla Postgres rejects as GUCs and keeps sslmode", () => {
    const out = normalizePgUrl(
      "postgresql://user:pw@ep-x-pooler.neon.tech/neondb?sslmode=require&channel_binding=require&gssencmode=disable",
    );
    expect(out).toContain("sslmode=require");
    expect(out).not.toContain("channel_binding");
    expect(out).not.toContain("gssencmode");
  });
});

describe("helpers", () => {
  it("paginate clamps page and size and fetches one extra row", () => {
    expect(paginate({ page: "2", pageSize: "25" })).toEqual({ page: 2, pageSize: 25, limit: 26, offset: 25 });
    expect(paginate({ page: -3, pageSize: 1000 })).toEqual({ page: 1, pageSize: 100, limit: 101, offset: 0 });
    expect(paginate({ page: "x" })).toMatchObject({ page: 1, pageSize: 25 });
    expect(toPage([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
    expect(toPage([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
  });
});

describe("withTx and advisory locks (PGlite)", () => {
  it("withTx opens a transaction once and joins an existing one", async () => {
    const { advisoryXactLock, isTransaction, tryAdvisoryXactLock, withTx } = await import("@/db/helpers");
    const t = await createTestDb({ setGlobal: false });
    try {
      expect(isTransaction(t.db)).toBe(false);
      const seen: boolean[] = [];
      await withTx(t.db, async (tx) => {
        seen.push(isTransaction(tx));
        await withTx(tx, async (inner) => {
          seen.push(inner === tx);
          await advisoryXactLock(inner, "b", "a", "a");
          expect(await tryAdvisoryXactLock(inner, "a")).toBe(true); // re-entrant within one session
        });
      });
      expect(seen).toEqual([true, true]);
      // A failing inner call rolls back the whole outer transaction.
      await expect(
        withTx(t.db, async (tx) => {
          await tx.execute(sql`create table rollback_probe (id int)`);
          await withTx(tx, async () => {
            throw new Error("boom");
          });
        }),
      ).rejects.toThrow("boom");
      const probe = firstRow<{ t: string | null }>(await t.db.execute(sql`select to_regclass('rollback_probe')::text as t`));
      expect(probe?.t ?? null).toBeNull();
    } finally {
      await t.close();
    }
  });
});

describe("business clock", () => {
  it("now() follows the fake time offset and resets", () => {
    const target = new Date("2030-01-01T12:00:00Z");
    setFakeNow(target);
    expect(Math.abs(now().getTime() - target.getTime())).toBeLessThan(1000);
    expect(getTimeOffsetMs()).not.toBe(0);
    setFakeNow(null);
    expect(getTimeOffsetMs()).toBe(0);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(50);
  });

  it("refuses fake time on Vercel", () => {
    process.env.VERCEL = "1";
    expect(() => setFakeNow("2030-01-01T00:00:00Z")).toThrow();
  });

  it("SQL comparisons see the fake time when it is passed as $now", async () => {
    const t = await createTestDb({ setGlobal: false, migrate: false });
    try {
      setFakeNow("2031-06-01T00:00:00Z");
      const row = firstRow<{ future: boolean }>(
        await t.db.execute(sql`select ${now()}::timestamptz > '2031-01-01T00:00:00Z'::timestamptz as future`),
      );
      expect(row?.future).toBe(true);
    } finally {
      await t.close();
    }
  });
});
