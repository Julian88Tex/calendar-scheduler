// Race safety infrastructure sample (ARCHITECTURE section 24.1): PGlite is a single backend, so concurrency tests
// need real Postgres. Two pool connections contend on the same transaction advisory lock; the second waits until the
// first commits, and a non-blocking attempt fails while the lock is held.
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { advisoryXactLock, firstRow, tryAdvisoryXactLock } from "@/db/helpers";
import { createTestDb } from "../helpers/db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.runIf(process.env.TEST_DATABASE_URL)("advisory locks on real Postgres", () => {
  it("serializes two connections on pg_advisory_xact_lock", async () => {
    const t = await createTestDb({ kind: "postgres" });
    try {
      const [a, b] = await Promise.all([t.connect(1), t.connect(1)]);
      const events: string[] = [];
      let releaseFirst!: () => void;
      const firstMayCommit = new Promise<void>((r) => (releaseFirst = r));
      let firstHasLock!: () => void;
      const firstLocked = new Promise<void>((r) => (firstHasLock = r));

      const first = a.transaction(async (tx) => {
        await advisoryXactLock(tx, "host:00000000-0000-0000-0000-000000000001");
        events.push("a:locked");
        firstHasLock();
        await firstMayCommit;
        events.push("a:commit");
      });

      await firstLocked;
      const second = b.transaction(async (tx) => {
        await advisoryXactLock(tx, "host:00000000-0000-0000-0000-000000000001");
        events.push("b:locked");
      });

      // While A holds the lock, B must still be waiting and a try-lock from a third connection must fail.
      await sleep(300);
      expect(events).toEqual(["a:locked"]);
      const c = await t.connect(1);
      const tryResult = await c.transaction(async (tx) => tryAdvisoryXactLock(tx, "host:00000000-0000-0000-0000-000000000001"));
      expect(tryResult).toBe(false);

      releaseFirst();
      await Promise.all([first, second]);
      expect(events).toEqual(["a:locked", "a:commit", "b:locked"]);
    } finally {
      await t.close();
    }
  });

  it("10 concurrent increments under the lock never lose an update", async () => {
    const t = await createTestDb({ kind: "postgres" });
    try {
      await t.db.execute(sql`create table counter (id int primary key, n int not null)`);
      await t.db.execute(sql`insert into counter values (1, 0)`);
      const pools = await Promise.all(Array.from({ length: 10 }, () => t.connect(1)));
      await Promise.all(
        pools.map((db) =>
          db.transaction(async (tx) => {
            await advisoryXactLock(tx, "counter");
            const row = firstRow<{ n: number }>(await tx.execute(sql`select n from counter where id = 1`));
            await sleep(5);
            await tx.execute(sql`update counter set n = ${Number(row?.n ?? 0) + 1} where id = 1`);
          }),
        ),
      );
      const row = firstRow<{ n: number }>(await t.db.execute(sql`select n from counter where id = 1`));
      expect(Number(row?.n)).toBe(10);
    } finally {
      await t.close();
    }
  });
});
