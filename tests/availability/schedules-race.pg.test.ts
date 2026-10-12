// Default schedule invariant under concurrency on real Postgres (SPEC AV-15, AV-02; run with npm run test:pg): every
// mutation holds the user's availability lock, so concurrent "Set as default" calls leave exactly one default,
// concurrent creates never exceed 50 schedules, and concurrent ensureDefaultSchedule calls create one default.
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const { availabilitySchedules } = await import("@/db/schema");
const { createSchedule, ensureDefaultSchedule, setDefaultSchedule, deleteSchedule } = await import("@/lib/availability");
const f = await import("../factories");
const { createTestDb } = await import("../helpers/db");

const live = (userId: string) =>
  and(eq(availabilitySchedules.userId, userId), isNull(availabilitySchedules.eventTypeId), isNull(availabilitySchedules.deletedAt));

describe.runIf(process.env.TEST_DATABASE_URL)("schedule races on real Postgres", () => {
  it("concurrent Set as default calls leave exactly one default", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    try {
      const user = await f.createUser(t.db);
      await f.createSchedule(t.db, { userId: user.id, name: "Working hours" });
      const others = await Promise.all(Array.from({ length: 6 }, (_, i) => f.createSchedule(t.db, { userId: user.id, name: `S${i}`, isDefault: false })));
      const results = await Promise.allSettled(others.map((s) => setDefaultSchedule(t.db, user.id, s.id)));
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const defaults = await t.db.select().from(availabilitySchedules).where(and(live(user.id), eq(availabilitySchedules.isDefault, true)));
      expect(defaults).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("concurrent creates never exceed 50 schedules", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    try {
      const user = await f.createUser(t.db);
      await f.createSchedule(t.db, { userId: user.id, name: "Working hours" });
      for (let i = 0; i < 47; i++) await f.createSchedule(t.db, { userId: user.id, name: `S${i}`, isDefault: false });
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => createSchedule(t.db, user.id, { name: `New ${i}` })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      const rows = await t.db.select().from(availabilitySchedules).where(live(user.id));
      expect(rows).toHaveLength(50);
    } finally {
      await t.close();
    }
  });

  it("concurrent ensureDefaultSchedule calls create one default, and delete never races it away", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    try {
      const user = await f.createUser(t.db);
      const made = await Promise.all(Array.from({ length: 8 }, () => t.db.transaction((tx) => ensureDefaultSchedule(tx, user.id, { timezone: "UTC" }))));
      expect(new Set(made.map((m) => m.id)).size).toBe(1);
      const extra = await createSchedule(t.db, user.id, { name: "Extra" });
      const [del, def] = await Promise.allSettled([deleteSchedule(t.db, user.id, extra.id), setDefaultSchedule(t.db, user.id, extra.id)]);
      const defaults = await t.db.select().from(availabilitySchedules).where(and(live(user.id), eq(availabilitySchedules.isDefault, true)));
      expect(defaults).toHaveLength(1);
      // Either the delete ran first (then Set as default fails: not found) or Set as default did (then delete is refused).
      expect([del.status, def.status].sort()).toEqual(["fulfilled", "rejected"]);
    } finally {
      await t.close();
    }
  });
});
