// Scheduling list bulk actions under concurrency on real Postgres (SPEC ET-08; run with npm run test:pg): every bulk
// action takes the owner's schedule lock and then locks its rows in id order inside one transaction, so overlapping
// selections sent in any order never deadlock, and overlapping deletes (bulk or single) delete and audit each row once:
// a bulk delete skips the actor's rows that a concurrent delete already removed instead of failing.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workflows", () => ({ copyEventTypeReminders: vi.fn(async () => 0) }));
vi.mock("@/lib/calendars", () => ({ getDestinationCalendar: vi.fn(async () => null) }));
vi.mock("@/lib/conferencing", () => ({ getConferencingOptions: vi.fn(async () => ({})) }));

const { auditLog, eventTypes } = await import("@/db/schema");
const { loadActorCtx } = await import("@/lib/authz");
const { isAppError } = await import("@/lib/errors");
const { deleteEventType, reorderEventTypes } = await import("@/lib/event-types");
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

  it("overlapping bulk deletes both succeed: the shared row is deleted (and audited) once, nothing deadlocks", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    try {
      const { actor, ids } = await setup(t, 5);
      const a = [ids[0]!, ids[1]!, ids[2]!];
      const b = [ids[4]!, ids[3]!, ids[2]!];
      const results = await Promise.allSettled([bulkDeleteEventTypes(t.db, actor, a), bulkDeleteEventTypes(t.db, actor, b)]);
      expect(results.filter((r) => r.status === "rejected")).toEqual([]);
      const live = await t.db.select({ id: eventTypes.id }).from(eventTypes).where(and(inArray(eventTypes.id, ids), isNull(eventTypes.deletedAt)));
      expect(live).toEqual([]);
      const audits = await t.db.select({ targetId: auditLog.targetId }).from(auditLog).where(eq(auditLog.action, "event_type.deleted"));
      expect(audits.map((x) => x.targetId).sort()).toEqual([...ids].sort());
    } finally {
      await t.close();
    }
  });

  it("a single delete racing a bulk delete of the same rows: both succeed, each row is deleted once", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    try {
      const { actor, ids } = await setup(t, 4);
      const results = await Promise.allSettled([
        deleteEventType(t.db, actor, ids[1]!),
        bulkDeleteEventTypes(t.db, actor, ids),
        deleteEventType(t.db, actor, ids[3]!),
      ]);
      // A single delete that lost the race reports not found (the row is already gone); the bulk delete never fails.
      expect(results[1]!.status).toBe("fulfilled");
      for (const r of results) if (r.status === "rejected") expect(isAppError(r.reason) && r.reason.code).toBe("not_found");
      const live = await t.db.select({ id: eventTypes.id }).from(eventTypes).where(and(inArray(eventTypes.id, ids), isNull(eventTypes.deletedAt)));
      expect(live).toEqual([]);
      const audits = await t.db.select({ targetId: auditLog.targetId }).from(auditLog).where(eq(auditLog.action, "event_type.deleted"));
      expect(audits.map((x) => x.targetId).sort()).toEqual([...ids].sort());
    } finally {
      await t.close();
    }
  });
});
