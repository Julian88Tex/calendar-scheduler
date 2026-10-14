// Scheduling list bulk actions under concurrency on real Postgres (SPEC ET-08; run with npm run test:pg): every bulk
// action locks its rows in id order inside one transaction, so overlapping selections sent in any order never
// deadlock, and an overlapping bulk delete is all or nothing (one wins, the other changes nothing).
import { and, eq, inArray, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workflows", () => ({ copyEventTypeReminders: vi.fn(async () => 0) }));
vi.mock("@/lib/calendars", () => ({ getDestinationCalendar: vi.fn(async () => null) }));
vi.mock("@/lib/conferencing", () => ({ getConferencingOptions: vi.fn(async () => ({})) }));

const { auditLog, eventTypes } = await import("@/db/schema");
const { loadActorCtx } = await import("@/lib/authz");
const { isAppError } = await import("@/lib/errors");
const { reorderEventTypes } = await import("@/lib/event-types");
const { bulkDeleteEventTypes, bulkSetEventTypesActive } = await import("@/app/(dashboard)/app/scheduling/_components/bulk");
const f = await import("../factories");
const { createTestDb } = await import("../helpers/db");

const isDeadlock = (e: unknown) => /deadlock/i.test(String((e as { cause?: unknown })?.cause ?? e)) || (e as { code?: string })?.code === "40P01";

async function setup(t: Awaited<ReturnType<typeof createTestDb>>, count: number) {
  const user = await f.createUser(t.db);
  await f.createSchedule(t.db, { userId: user.id });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push((await f.createEventType(t.db, { owner: user, name: `Type ${i}`, overrides: { position: i } })).eventType.id);
  return { actor: await loadActorCtx(t.db, user), ids };
}

describe.runIf(process.env.TEST_DATABASE_URL)("bulk actions on real Postgres", () => {
  it("overlapping bulk On/Off and reorders sent in different orders never deadlock", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    try {
      const { actor, ids } = await setup(t, 6);
      const reversed = [...ids].reverse();
      const results = await Promise.allSettled([
        bulkSetEventTypesActive(t.db, actor, ids, false),
        bulkSetEventTypesActive(t.db, actor, reversed, false),
        bulkSetEventTypesActive(t.db, actor, [ids[3]!, ids[0]!, ids[5]!], false),
        bulkSetEventTypesActive(t.db, actor, [ids[5]!, ids[1]!, ids[2]!, ids[4]!], false),
        reorderEventTypes(t.db, actor, reversed),
        bulkSetEventTypesActive(t.db, actor, [ids[2]!, ids[0]!], false),
      ]);
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(failures.filter((r) => isDeadlock(r.reason))).toEqual([]);
      expect(failures).toEqual([]);
      const rows = await t.db.select({ active: eventTypes.active }).from(eventTypes).where(inArray(eventTypes.id, ids));
      expect(rows.every((r) => !r.active)).toBe(true);
    } finally {
      await t.close();
    }
  });

  it("overlapping bulk deletes: one selection wins whole, the other changes nothing", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    try {
      const { actor, ids } = await setup(t, 5);
      const a = [ids[0]!, ids[1]!, ids[2]!];
      const b = [ids[4]!, ids[3]!, ids[2]!];
      const [ra, rb] = await Promise.allSettled([bulkDeleteEventTypes(t.db, actor, a), bulkDeleteEventTypes(t.db, actor, b)]);
      const outcomes = [ra, rb].map((r) => r!.status);
      expect(outcomes.sort()).toEqual(["fulfilled", "rejected"]);
      const rejected = [ra, rb].find((r): r is PromiseRejectedResult => r!.status === "rejected")!;
      expect(isDeadlock(rejected.reason)).toBe(false);
      expect(isAppError(rejected.reason) && rejected.reason.code).toBe("not_found");

      const winner = ra!.status === "fulfilled" ? a : b;
      const live = await t.db.select({ id: eventTypes.id }).from(eventTypes).where(and(inArray(eventTypes.id, ids), isNull(eventTypes.deletedAt)));
      expect(new Set(live.map((r) => r.id))).toEqual(new Set(ids.filter((id) => !winner.includes(id))));
      const audits = await t.db.select({ targetId: auditLog.targetId }).from(auditLog).where(eq(auditLog.action, "event_type.deleted"));
      expect(audits.map((x) => x.targetId).sort()).toEqual([...winner].sort());
    } finally {
      await t.close();
    }
  });
});
