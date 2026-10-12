// POST /api/test/reset (E2E only): truncates every application table and restores real time.
// app_secrets is kept so the generated session and encryption secrets stay stable for the running server.
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { resetFakeTime } from "@/lib/time/now";
import { testJson, withTestGuard } from "../_lib/guard";

export const dynamic = "force-dynamic";

const KEEP = new Set(["app_secrets"]);

export const POST = withTestGuard(async () => {
  const db = await getDb();
  const tables = Object.values(schema)
    .filter((v) => is(v, PgTable))
    .map((t) => getTableName(t as PgTable))
    .filter((name) => !KEEP.has(name))
    .sort();
  await db.execute(sql.raw(`truncate table ${tables.map((t) => `"${t}"`).join(", ")} restart identity cascade`));
  resetFakeTime();
  return testJson({ ok: true, truncated: tables.length });
});
