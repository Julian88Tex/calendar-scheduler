// Parameter and result contracts of postgres.js as production runs it (drizzle-orm/postgres-js, prepare: false), on
// real Postgres (npm run test:pg). PGlite behaves differently in exactly these places, so the default suite cannot
// see them:
// - drizzle registers transparent serializers for timestamp, timestamptz, date, time, json and jsonb parameters, so
//   a JS Date (or a plain object) that reaches the wire without a column encoder fails: a Date inside a raw sql``
//   template, or the right side of an operator whose left side is sql`` (the system.cleanup production failure);
// - postgres.js serializes a raw parameter with the type Postgres infers for it: a string or number compared with a
//   boolean becomes false (no error, no rows), a number or object where jsonb is expected fails, and a boolean (sent
//   typed as bool) cannot be cast to jsonb; PGlite sends all of them as text and accepts them;
// - int8 results (count(*), sum(integer)) come back as strings, where PGlite returns numbers;
// - timestamps filled by the database default (defaultNow()) carry microseconds, which a JS Date drops (PGlite's clock
//   has millisecond resolution).
// The helpers in src/lib convert values before they reach a template (ISO strings, typed operators), and
// tests/pg/sql-params.static.test.ts rejects raw parameters of the unsafe types in the default suite; these canaries
// fail when a driver upgrade changes the contract, and the helper cases fail when a helper regresses.
import { and, asc, count, eq, inArray, lt, sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { jobs } from "@/db/schema";
import { keysetAfter } from "@/lib/pagination";
import { createTestDb, type TestDb } from "../helpers/db";

const AT = new Date("2031-03-10T12:00:00Z");
const MIN = 60_000;
/** A table of this file's database only (created in beforeAll). */
const flags = pgTable("contract_flags", {
  id: integer("id").primaryKey(),
  flag: boolean("flag").notNull(),
  doc: jsonb("doc").$type<Record<string, unknown>>().notNull(),
});

describe.runIf(process.env.TEST_DATABASE_URL)("postgres.js parameter and result contracts", () => {
  let t: TestDb;
  let db: DB;
  let ids: string[];

  beforeAll(async () => {
    t = await createTestDb({ kind: "postgres" });
    db = t.db;
    const rows = await db
      .insert(jobs)
      .values([0, 1, 2, 3].map((i) => ({ type: `contract.${i}`, status: "pending" as const, runAt: new Date(AT.getTime() + i * MIN) })))
      .returning({ id: jobs.id });
    ids = rows.map((r) => r.id);
    await db.execute(sql`create table contract_flags (id integer primary key, flag boolean not null, doc jsonb not null)`);
    await db.insert(flags).values({ id: 1, flag: true, doc: {} });
  });
  afterAll(async () => {
    await t?.close();
  });

  it("canary: a raw Date in a sql`` template is rejected by postgres.js (PGlite accepts it)", async () => {
    await expect(db.select({ id: jobs.id }).from(jobs).where(sql`${jobs.runAt} < ${AT}`)).rejects.toThrow();
    await expect(db.select({ id: jobs.id }).from(jobs).where(lt(sql`coalesce(${jobs.finishedAt}, ${jobs.runAt})`, AT))).rejects.toThrow();
  });

  it("an ISO string with an explicit cast, or a typed operator, works", async () => {
    const viaCast = await db.select({ id: jobs.id }).from(jobs).where(sql`${jobs.runAt} < ${new Date(AT.getTime() + 2 * MIN).toISOString()}::timestamptz`);
    const viaOperator = await db.select({ id: jobs.id }).from(jobs).where(lt(jobs.runAt, new Date(AT.getTime() + 2 * MIN)));
    expect(viaCast.map((r) => r.id).sort()).toEqual(viaOperator.map((r) => r.id).sort());
    expect(viaCast).toHaveLength(2);
  });

  it("keysetAfter accepts Date cursor values (sent as ISO strings)", async () => {
    const page = await db
      .select({ id: jobs.id, runAt: jobs.runAt })
      .from(jobs)
      .where(keysetAfter([jobs.runAt, jobs.id], [new Date(AT.getTime() + MIN), ids[1]!], "asc"))
      .orderBy(asc(jobs.runAt), asc(jobs.id));
    expect(page.map((r) => r.id)).toEqual([ids[2], ids[3]]);
    const back = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(keysetAfter([jobs.runAt, jobs.id], [new Date(AT.getTime() + 2 * MIN).toISOString(), ids[2]!], "desc"))
      .orderBy(asc(jobs.runAt));
    expect(back.map((r) => r.id)).toEqual([ids[0], ids[1]]);
  });

  it("canary: int8 results are strings on postgres.js; count() and ::int casts give numbers", async () => {
    const [raw] = await db.select({ n: sql<unknown>`count(*)` }).from(jobs);
    expect(typeof raw!.n).toBe("string");
    const [cast] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs);
    expect(cast!.n).toBe(4);
    const [helper] = await db.select({ n: count() }).from(jobs).where(eq(jobs.status, "pending"));
    expect(helper!.n).toBe(4);
  });

  it("canary: a string or number compared with a boolean is sent as false (no error, no rows); a typed operator works", async () => {
    const ids = async (where: ReturnType<typeof sql>) => (await db.select({ id: flags.id }).from(flags).where(where)).map((r) => r.id);
    expect(await ids(sql`${flags.flag} = ${"true"}`)).toEqual([]);
    expect(await ids(sql`${flags.flag} = ${1}`)).toEqual([]);
    expect(await ids(eq(flags.flag, true))).toEqual([1]);
  });

  it("canary: an object, a number or a boolean cannot reach a jsonb parameter; JSON.stringify with ::jsonb can", async () => {
    await expect(db.select({ doc: sql`${flags.doc} || ${{ a: 1 }}` }).from(flags)).rejects.toThrow();
    await expect(db.select({ doc: sql`${flags.doc} || ${5}` }).from(flags)).rejects.toThrow();
    await expect(db.select({ doc: sql`${true}::jsonb` }).from(flags)).rejects.toThrow();
    const [merged] = await db.select({ doc: sql<Record<string, unknown>>`${flags.doc} || ${JSON.stringify({ a: 1, ok: true })}::jsonb` }).from(flags);
    expect(merged!.doc).toEqual({ a: 1, ok: true });
    await db.update(flags).set({ doc: { b: 2, ok: false } }).where(eq(flags.id, 1));
    expect((await db.select({ doc: flags.doc }).from(flags))[0]!.doc).toEqual({ b: 2, ok: false });
  });

  it("canary: defaultNow() timestamps carry microseconds, so a Date cursor on them returns the cursor row again", async () => {
    // One statement per row: now() is the transaction start, so rows of one insert would share it.
    const made: { id: string; createdAt: Date }[] = [];
    for (let i = 0; i < 5; i++) {
      const [r] = await db.insert(jobs).values({ type: `contract.default_now.${i}`, status: "pending", runAt: AT }).returning({ id: jobs.id, createdAt: jobs.createdAt });
      made.push(r!);
    }
    const rows = await db
      .select({ id: jobs.id, us: sql<number>`(extract(microseconds from ${jobs.createdAt})::int % 1000)` })
      .from(jobs)
      .where(inArray(jobs.id, made.map((m) => m.id)));
    const sub = made.find((m) => rows.some((r) => r.id === m.id && r.us !== 0));
    expect(sub, "a row with sub-millisecond precision").toBeTruthy();
    const again = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(inArray(jobs.id, made.map((m) => m.id)), keysetAfter([jobs.createdAt, jobs.id], [sub!.createdAt, sub!.id], "asc")));
    expect(again.map((r) => r.id)).toContain(sub!.id);
  });
});
