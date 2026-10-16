// Race safety of the workflow engine on real Postgres (SPEC NT-15 idempotency, NT-09; run with npm run test:pg):
// concurrent writers of the same execution keys create one execution and one job; a booking subscriber racing the
// backfill for the same invitee schedules one reminder; concurrent "turn on" clicks create one basic reminder row.
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { jobs, workflowExecutions, workflows } from "@/db/schema";
import { loadActorCtx } from "@/lib/authz";
import { runBackfill } from "@/lib/workflows/backfill";
import { computeExecutions } from "@/lib/workflows/engine";
import { setEventTypeRemindersEnabled } from "@/lib/workflows/reminders";
import { engineSteps, engineWorkflow, upsertExecutions } from "@/lib/workflows/store";
import { workflowSubscribers } from "@/lib/workflows/subscriber-handlers";
import { now } from "@/lib/time/now";
import * as f from "../factories";
import { createTestDb } from "../helpers/db";
import { book, DAY, domainEvent, jobCtx, setupOwner } from "./helpers";

describe.runIf(process.env.TEST_DATABASE_URL)("workflow races on real Postgres", () => {
  it("concurrent writers of the same executions create one row and one job per key", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 4 });
    try {
      const { owner, eventType } = await setupOwner(t.db);
      const { workflow, steps } = await f.createWorkflow(t.db, { owner, eventTypeIds: [eventType.id] });
      const m = await book(t.db, eventType, 3 * DAY);
      const pools = await Promise.all(Array.from({ length: 6 }, () => t.connect(1)));
      const meeting = { ...m.scheduledEvent, status: "active" as const };
      const computed = computeExecutions(engineWorkflow(workflow), engineSteps(steps), meeting, [m.invitee!], "before_start", { now: now() });
      const rows = computed.map((c) => ({ ...c, workflowId: workflow.id, scheduledEventId: m.scheduledEvent.id }));
      await Promise.all(pools.map((db, i) => db.transaction((tx) => upsertExecutions(tx, rows, { reviveReasons: i % 2 ? ["unassigned"] : [] }))));
      const executions = await t.db.select().from(workflowExecutions).where(eq(workflowExecutions.inviteeId, m.invitee!.id));
      expect(executions).toHaveLength(1);
      const keyed = await t.db.select().from(jobs).where(eq(jobs.idempotencyKey, `workflows.execute:${executions[0]!.id}`));
      expect(keyed).toHaveLength(1);
      expect(executions[0]!.jobId).toBe(keyed[0]!.id);
    } finally {
      await t.close();
    }
  });

  it("a booking subscriber racing the backfill schedules one reminder per invitee", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 4 });
    try {
      const { owner, eventType } = await setupOwner(t.db);
      const { workflow } = await f.createWorkflow(t.db, { owner, eventTypeIds: [eventType.id] });
      const bookings = await Promise.all(Array.from({ length: 5 }, (_, i) => book(t.db, eventType, (3 + i) * DAY)));
      const a = await t.connect(2);
      const b = await t.connect(2);
      await Promise.all([
        ...bookings.map((m) =>
          workflowSubscribers["booking.created"]!(
            domainEvent("booking.created", { scheduledEventId: m.scheduledEvent.id, inviteeId: m.invitee!.id, source: "booking_page" }),
            jobCtx(a),
          ),
        ),
        runBackfill({ workflowId: workflow.id }, jobCtx(b)),
        runBackfill({ workflowId: workflow.id }, jobCtx(b)),
      ]);
      const executions = await t.db.select().from(workflowExecutions).where(eq(workflowExecutions.workflowId, workflow.id));
      expect(executions).toHaveLength(5);
      expect(new Set(executions.map((e) => e.inviteeId)).size).toBe(5);
      const executeJobs = await t.db.select().from(jobs).where(eq(jobs.type, "workflows.execute"));
      expect(executeJobs).toHaveLength(5);
    } finally {
      await t.close();
    }
  });

  it("concurrent turn-on clicks create one basic reminder row", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 4 });
    try {
      const { owner, eventType } = await setupOwner(t.db);
      const pools = await Promise.all(Array.from({ length: 4 }, () => t.connect(1)));
      const results = await Promise.allSettled(
        pools.map(async (db) => setEventTypeRemindersEnabled(await loadActorCtx(db, owner), { eventTypeId: eventType.id, kind: "invitee", enabled: true }, db)),
      );
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const live = await t.db
        .select()
        .from(workflows)
        .where(and(eq(workflows.basicEventTypeId, eventType.id), isNull(workflows.deletedAt)));
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({ active: true, offsetMinutes: 1440 });
    } finally {
      await t.close();
    }
  });
});
