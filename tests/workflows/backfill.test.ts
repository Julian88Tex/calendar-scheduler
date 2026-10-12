// The workflows.backfill job (SPEC NT-13, NT-15 "Backfill", ET-25) on PGlite: every scope rule, idempotency,
// revival of executions canceled by unassignment or deactivation, and paging (with equal start times).
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { invitees, jobs, scheduledEvents, workflowEventTypes, workflowExecutions, workflows } from "@/db/schema";
import { resetFakeTime } from "@/lib/time/now";
import { backfillKey, enqueueBackfill, runBackfill } from "@/lib/workflows/backfill";
import { cancelExecutions } from "@/lib/workflows/store";
import * as f from "../factories";
import { useTestDb } from "../helpers/db";
import { book, DAY, executionsWhere, HOUR, jobCtx, runWorkflowJobs, setupOwner } from "./helpers";

const t = useTestDb();

afterEach(() => resetFakeTime());

async function backfill(workflowId: string, extra: Record<string, unknown> = {}) {
  return (await runBackfill({ workflowId, ...extra }, jobCtx(t.db))).result;
}

const forWorkflow = (workflowId: string) => executionsWhere(t.db, eq(workflowExecutions.workflowId, workflowId));

describe("scope", () => {
  it("covers future active meetings of the workflow's event types and nothing else", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    const { eventType: otherType } = await f.createEventType(t.db, { owner });
    const { workflow } = await f.createWorkflow(t.db, { owner, offsetMinutes: 1440, eventTypeIds: [eventType.id] });

    const inThreeDays = await book(t.db, eventType, 3 * DAY);
    const inTwoHours = await book(t.db, eventType, 2 * HOUR);
    const past = await book(t.db, eventType, -DAY);
    const canceledMeeting = await book(t.db, eventType, 4 * DAY, {}, { status: "canceled" });
    const canceledInvitee = await book(t.db, eventType, 4 * DAY, { status: "canceled" });
    const otherTypeMeeting = await book(t.db, otherType, 4 * DAY);
    const { poll } = await f.createPoll(t.db, { owner });
    const pollMeeting = await book(t.db, eventType, 4 * DAY);
    await t.db.update(scheduledEvents).set({ pollId: poll.id }).where(eq(scheduledEvents.id, pollMeeting.scheduledEvent.id));
    const stranger = await setupOwner(t.db);
    const strangerMeeting = await book(t.db, stranger.eventType, 4 * DAY);
    await t.db.insert(workflowEventTypes).values({ workflowId: workflow.id, eventTypeId: stranger.eventType.id });

    const out = await backfill(workflow.id);
    expect(out).toMatchObject({ scheduled: 1, revived: 0, nextPage: false });
    const rows = await forWorkflow(workflow.id);
    expect(rows.map((r) => r.inviteeId)).toEqual([inThreeDays.invitee!.id]);
    expect(rows[0]!.runAt.getTime()).toBe(inThreeDays.scheduledEvent.startAt.getTime() - DAY);
    // No skipped rows for the meeting in 2 hours (run time already past).
    for (const m of [inTwoHours, past, canceledMeeting, canceledInvitee, otherTypeMeeting, pollMeeting, strangerMeeting]) {
      expect(rows.some((r) => r.scheduledEventId === m.scheduledEvent.id)).toBe(false);
    }
    const [job] = await t.db.select().from(jobs).where(eq(jobs.idempotencyKey, `workflows.execute:${rows[0]!.id}`));
    expect(job).toMatchObject({ status: "pending", type: "workflows.execute" });
  });

  it("backfills starts and ends triggers but never event-driven ones", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    const m = await book(t.db, eventType, 2 * DAY);
    const { workflow: ends } = await f.createWorkflow(t.db, { owner, trigger: "ends", offsetMinutes: 15, eventTypeIds: [eventType.id] });
    const { workflow: starts } = await f.createWorkflow(t.db, { owner, trigger: "starts", offsetMinutes: 0, eventTypeIds: [eventType.id] });
    const { workflow: booked } = await f.createWorkflow(t.db, { owner, trigger: "booked", offsetMinutes: 0, eventTypeIds: [eventType.id] });
    const { workflow: canceled } = await f.createWorkflow(t.db, { owner, trigger: "canceled", offsetMinutes: 0, eventTypeIds: [eventType.id] });
    expect((await backfill(ends.id)).scheduled).toBe(1);
    expect((await backfill(starts.id)).scheduled).toBe(1);
    expect(await backfill(booked.id)).toMatchObject({ scheduled: 0, skipped: "event_trigger" });
    expect(await backfill(canceled.id)).toMatchObject({ scheduled: 0, skipped: "event_trigger" });
    const [e] = await forWorkflow(ends.id);
    expect(e!.runAt.getTime()).toBe(m.scheduledEvent.endAt.getTime() + 15 * 60_000);
  });

  it("does nothing for off or deleted workflows and honors the eventTypeIds filter", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    const { eventType: second } = await f.createEventType(t.db, { owner });
    await book(t.db, eventType, 3 * DAY);
    const b = await book(t.db, second, 3 * DAY);
    const { workflow: off } = await f.createWorkflow(t.db, { owner, active: false, eventTypeIds: [eventType.id] });
    expect(await backfill(off.id)).toMatchObject({ skipped: "off" });
    const { workflow: gone } = await f.createWorkflow(t.db, { owner, eventTypeIds: [eventType.id] });
    await t.db.update(workflows).set({ deletedAt: new Date() }).where(eq(workflows.id, gone.id));
    expect(await backfill(gone.id)).toMatchObject({ skipped: "deleted" });
    const { workflow } = await f.createWorkflow(t.db, { owner, eventTypeIds: [eventType.id, second.id] });
    expect((await backfill(workflow.id, { eventTypeIds: [second.id] })).scheduled).toBe(1);
    expect((await forWorkflow(workflow.id)).map((r) => r.scheduledEventId)).toEqual([b.scheduledEvent.id]);
    // An event type the workflow no longer covers is ignored even when the payload names it.
    const { workflow: narrow } = await f.createWorkflow(t.db, { owner, eventTypeIds: [eventType.id] });
    expect(await backfill(narrow.id, { eventTypeIds: [second.id] })).toMatchObject({ skipped: "no_event_types" });
    await expect(runBackfill({ workflowId: "x" }, jobCtx(t.db))).rejects.toThrow("Malformed");
  });

  it("group slots get one host execution and one invitee execution per active invitee", async () => {
    const { owner, eventType } = await setupOwner(t.db, { eventType: { kind: "group", maxInvitees: 5 } });
    const { workflow } = await f.createWorkflow(t.db, {
      owner,
      eventTypeIds: [eventType.id],
      steps: [{ action: "email_invitees" }, { action: "email_host" }],
    });
    const m = await book(t.db, eventType, 3 * DAY, {}, { invitees: [{ name: "A" }, { name: "B" }, { name: "C", status: "canceled" }] });
    expect((await backfill(workflow.id)).scheduled).toBe(3);
    const rows = await forWorkflow(workflow.id);
    expect(rows.filter((r) => r.inviteeId === null)).toHaveLength(1);
    expect(rows.filter((r) => r.inviteeId !== null).map((r) => r.inviteeId).sort()).toEqual(m.invitees.slice(0, 2).map((i) => i.id).sort());
  });
});

describe("idempotency", () => {
  it("leaves existing executions alone and never duplicates", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    const { workflow } = await f.createWorkflow(t.db, { owner, eventTypeIds: [eventType.id] });
    await book(t.db, eventType, 3 * DAY);
    await backfill(workflow.id);
    const [first] = await forWorkflow(workflow.id);
    // A second run with changed config keeps the scheduled execution's snapshot.
    const again = await backfill(workflow.id);
    expect(again).toMatchObject({ scheduled: 0, revived: 0 });
    const rows = await forWorkflow(workflow.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first!.id, status: "scheduled" });
  });

  it("revives executions canceled by unassignment or deactivation with the current config, and nothing else", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    const { workflow } = await f.createWorkflow(t.db, { owner, eventTypeIds: [eventType.id] });
    const a = await book(t.db, eventType, 3 * DAY);
    const b = await book(t.db, eventType, 4 * DAY);
    const c = await book(t.db, eventType, 5 * DAY);
    await backfill(workflow.id);
    const rows = await forWorkflow(workflow.id);
    const byInvitee = (id: string) => rows.find((r) => r.inviteeId === id)!;
    await cancelExecutions(t.db, eq(workflowExecutions.id, byInvitee(a.invitee!.id).id), "unassigned");
    await cancelExecutions(t.db, eq(workflowExecutions.id, byInvitee(b.invitee!.id).id), "deactivated");
    await cancelExecutions(t.db, eq(workflowExecutions.id, byInvitee(c.invitee!.id).id), "invitee_canceled");
    await t.db.update(workflows).set({ name: "Renamed" }).where(eq(workflows.id, workflow.id));
    const out = await backfill(workflow.id);
    expect(out).toMatchObject({ revived: 2, scheduled: 0 });
    const after = await forWorkflow(workflow.id);
    const get = (id: string) => after.find((r) => r.inviteeId === id)!;
    expect(get(a.invitee!.id)).toMatchObject({ status: "scheduled", skipReason: null, snapshot: expect.objectContaining({ workflowName: "Renamed" }) });
    expect(get(b.invitee!.id)).toMatchObject({ status: "scheduled", skipReason: null });
    expect(get(c.invitee!.id)).toMatchObject({ status: "canceled", skipReason: "invitee_canceled" });
    // Revived executions have a live job again.
    const revivedJobs = await t.db
      .select()
      .from(jobs)
      .where(inArray(jobs.idempotencyKey, [get(a.invitee!.id).id, get(b.invitee!.id).id].map((id) => `workflows.execute:${id}`)));
    expect(revivedJobs.map((j) => j.status)).toEqual(["pending", "pending"]);
  });

  it("unassigning and reassigning an event type leaves exactly one scheduled execution (NT-13)", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    const { workflow } = await f.createWorkflow(t.db, { owner, eventTypeIds: [eventType.id] });
    const m = await book(t.db, eventType, 3 * DAY);
    await backfill(workflow.id);
    await t.db.delete(workflowEventTypes).where(and(eq(workflowEventTypes.workflowId, workflow.id), eq(workflowEventTypes.eventTypeId, eventType.id)));
    await cancelExecutions(t.db, eq(workflowExecutions.workflowId, workflow.id), "unassigned");
    expect(await backfill(workflow.id)).toMatchObject({ skipped: "no_event_types" });
    await t.db.insert(workflowEventTypes).values({ workflowId: workflow.id, eventTypeId: eventType.id });
    await backfill(workflow.id);
    const rows = await executionsWhere(t.db, eq(workflowExecutions.inviteeId, m.invitee!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("scheduled");
  });

  it("enqueueBackfill dedupes per saved version", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    const { workflow } = await f.createWorkflow(t.db, { owner, eventTypeIds: [eventType.id] });
    const v = new Date("2030-01-01T00:00:00Z");
    expect(await enqueueBackfill(t.db, { workflowId: workflow.id, version: v })).toBeTruthy();
    expect(await enqueueBackfill(t.db, { workflowId: workflow.id, version: v })).toBeNull();
    expect(await enqueueBackfill(t.db, { workflowId: workflow.id, version: new Date(v.getTime() + 1) })).toBeTruthy();
    expect(backfillKey(workflow.id, v)).toBe(`backfill:${workflow.id}:${v.getTime()}`);
  });
});

describe("paging", () => {
  it("pages through invitees in (start, id) order, re-enqueueing itself, including ties on the start time", async () => {
    const { owner, eventType } = await setupOwner(t.db, { eventType: { kind: "group", maxInvitees: 10 } });
    const { workflow } = await f.createWorkflow(t.db, { owner, eventTypeIds: [eventType.id] });
    // 3 invitees in one slot (same start) and 2 single-invitee slots later.
    const slot = await book(t.db, eventType, 3 * DAY, {}, { invitees: [{ name: "A" }, { name: "B" }, { name: "C" }] });
    const later1 = await book(t.db, eventType, 4 * DAY);
    const later2 = await book(t.db, eventType, 5 * DAY);
    const rootKey = backfillKey(workflow.id, 1);
    await t.db.insert(jobs).values({ type: "workflows.backfill", payload: { workflowId: workflow.id, rootKey, pageSize: 2 }, runAt: new Date(0), idempotencyKey: rootKey });
    const ran = await runWorkflowJobs(t.db, { max: 50 });
    const pages = (await t.db.select().from(jobs).where(eq(jobs.type, "workflows.backfill"))).filter((j) => j.payload.workflowId === workflow.id);
    expect(pages.length).toBe(3);
    expect(pages.every((p) => p.status === "succeeded")).toBe(true);
    expect(ran).toBeGreaterThanOrEqual(3);
    const rows = (await forWorkflow(workflow.id)).filter((r) => r.status === "scheduled" || r.status === "sent" || r.status === "skipped");
    const invited = [...slot.invitees, later1.invitee!, later2.invitee!].map((i) => i.id).sort();
    expect([...new Set(rows.map((r) => r.inviteeId))].sort()).toEqual(invited);
    expect(rows.filter((r) => r.trigger === "before_start")).toHaveLength(5);
    // The invitee table is untouched by the backfill.
    expect((await t.db.select().from(invitees).where(eq(invitees.scheduledEventId, slot.scheduledEvent.id))).length).toBe(3);
  });
});
