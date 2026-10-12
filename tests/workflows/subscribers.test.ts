// Subscriber scheduling (SPEC NT-15, NT-19; ARCHITECTURE section 14) on PGlite: booking.created, booking.canceled,
// booking.rescheduled and booking.no_show_created write executions and workflows.execute jobs with the documented
// keys, snapshots and skip reasons, idempotently. The last test goes through publishEvent and the real job registry.
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { invitees, jobs, scheduledEvents, workflowExecutions, workflowSteps, workflows } from "@/db/schema";
import { resetFakeTime } from "@/lib/time/now";
import { workflowSubscribers as subs } from "@/lib/workflows/subscriber-handlers";
import * as f from "../factories";
import { useTestDb } from "../helpers/db";
import { activityOf, book, DAY, domainEvent, executionsWhere, HOUR, jobCtx, jobOf, MINUTE, scheduledFor, setupOwner } from "./helpers";

const t = useTestDb();

afterEach(() => resetFakeTime());

async function created(scheduledEventId: string, inviteeId: string) {
  await subs["booking.created"]!(domainEvent("booking.created", { scheduledEventId, inviteeId, source: "booking_page" }), jobCtx(t.db));
}

async function reminderWorkflow(owner: f.TestUser, eventTypeId: string, opts: { offset?: number; trigger?: "before_start" | "canceled" | "rescheduled" | "no_show" | "ends" | "booked"; active?: boolean; action?: "email_invitees" | "email_host" } = {}) {
  return f.createWorkflow(t.db, {
    owner,
    trigger: opts.trigger ?? "before_start",
    offsetMinutes: opts.offset ?? 1440,
    active: opts.active ?? true,
    eventTypeIds: [eventTypeId],
    steps: [{ action: opts.action ?? "email_invitees", subject: "Reminder: {{event_name}}", bodyHtml: "<p>Soon.</p>" }],
  });
}

describe("booking.created", () => {
  it("schedules one execution and one job per action at start - offset", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    const { steps } = await f.createWorkflow(t.db, {
      owner,
      eventTypeIds: [eventType.id],
      steps: [
        { action: "email_invitees", subject: "Reminder: {{event_name}}" },
        { action: "email_host", subject: "Heads up" },
      ],
    });
    const m = await book(t.db, eventType, 3 * DAY);
    await created(m.scheduledEvent.id, m.invitee!.id);
    const rows = await scheduledFor(t.db, m.invitee!.id);
    expect(rows).toHaveLength(2);
    for (const e of rows) {
      expect(e.runAt.getTime()).toBe(m.scheduledEvent.startAt.getTime() - DAY);
      expect(e.idempotencyKey).toBe(`${e.stepId}:${m.invitee!.id}:before_start`);
      const job = await jobOf(t.db, e.id);
      expect(job).toMatchObject({ type: "workflows.execute", status: "pending", groupKey: `wf:${m.invitee!.id}`, priority: 5 });
      expect(job!.runAt.getTime()).toBe(e.runAt.getTime());
      expect(e.jobId).toBe(job!.id);
    }
    expect(rows.map((r) => r.stepId).sort()).toEqual(steps.map((s) => s.id).sort());
  });

  it("is idempotent when the subscriber job runs twice", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    await reminderWorkflow(owner, eventType.id);
    const m = await book(t.db, eventType, 3 * DAY);
    await created(m.scheduledEvent.id, m.invitee!.id);
    await created(m.scheduledEvent.id, m.invitee!.id);
    const rows = await executionsWhere(t.db, eq(workflowExecutions.inviteeId, m.invitee!.id));
    expect(rows).toHaveLength(1);
    expect(await t.db.select().from(jobs).where(eq(jobs.groupKey, `wf:${m.invitee!.id}`))).toHaveLength(1);
  });

  it("freezes the action config: edits after booking do not change that execution (snapshot)", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    const { steps } = await reminderWorkflow(owner, eventType.id);
    const before = await book(t.db, eventType, 3 * DAY);
    await created(before.scheduledEvent.id, before.invitee!.id);
    await t.db.update(workflowSteps).set({ subject: "New subject" }).where(eq(workflowSteps.id, steps[0]!.id));
    const after = await book(t.db, eventType, 4 * DAY);
    await created(after.scheduledEvent.id, after.invitee!.id);
    expect((await scheduledFor(t.db, before.invitee!.id))[0]!.snapshot.subject).toBe("Reminder: {{event_name}}");
    expect((await scheduledFor(t.db, after.invitee!.id))[0]!.snapshot.subject).toBe("New subject");
  });

  it("skips a reminder booked too close with booked_too_close and logs it", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    await reminderWorkflow(owner, eventType.id);
    const m = await book(t.db, eventType, 2 * HOUR);
    await created(m.scheduledEvent.id, m.invitee!.id);
    const [e] = await executionsWhere(t.db, eq(workflowExecutions.inviteeId, m.invitee!.id));
    expect(e).toMatchObject({ status: "skipped", skipReason: "booked_too_close" });
    expect(await jobOf(t.db, e!.id)).toBeNull();
    const activity = await activityOf(t.db, m.scheduledEvent.id);
    expect(activity).toEqual([expect.objectContaining({ type: "workflow_skipped", data: expect.objectContaining({ reason: "booked_too_close" }) })]);
  });

  it("ignores inactive and deleted workflows, other event types and other organizations", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    await reminderWorkflow(owner, eventType.id, { active: false });
    const { workflow: deleted } = await reminderWorkflow(owner, eventType.id, { offset: 60 });
    await t.db.update(workflows).set({ deletedAt: new Date() }).where(eq(workflows.id, deleted.id));
    const { eventType: other } = await f.createEventType(t.db, { owner });
    await reminderWorkflow(owner, other.id, { offset: 30 });
    const stranger = await setupOwner(t.db);
    await f.createWorkflow(t.db, { owner: stranger.owner, eventTypeIds: [eventType.id] });
    const m = await book(t.db, eventType, 3 * DAY);
    await created(m.scheduledEvent.id, m.invitee!.id);
    expect(await executionsWhere(t.db, eq(workflowExecutions.inviteeId, m.invitee!.id))).toEqual([]);
  });

  it("creates nothing for poll and one-off meetings, or invitees already canceled", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    await reminderWorkflow(owner, eventType.id);
    const { poll } = await f.createPoll(t.db, { owner });
    const m = await book(t.db, eventType, 3 * DAY);
    await t.db.update(scheduledEvents).set({ pollId: poll.id }).where(eq(scheduledEvents.id, m.scheduledEvent.id));
    await created(m.scheduledEvent.id, m.invitee!.id);
    expect(await executionsWhere(t.db, eq(workflowExecutions.inviteeId, m.invitee!.id))).toEqual([]);
    const gone = await book(t.db, eventType, 3 * DAY, { status: "canceled" });
    await created(gone.scheduledEvent.id, gone.invitee!.id);
    expect(await executionsWhere(t.db, eq(workflowExecutions.inviteeId, gone.invitee!.id))).toEqual([]);
  });
});

describe("booking.canceled", () => {
  it("cancels the invitee's pending executions and jobs, then schedules Event is canceled ones", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    await reminderWorkflow(owner, eventType.id);
    await reminderWorkflow(owner, eventType.id, { trigger: "canceled", offset: 0 });
    const m = await book(t.db, eventType, 3 * DAY);
    await created(m.scheduledEvent.id, m.invitee!.id);
    const [pending] = await scheduledFor(t.db, m.invitee!.id);
    const canceledAt = new Date();
    await t.db.update(invitees).set({ status: "canceled", canceledAt }).where(eq(invitees.id, m.invitee!.id));
    await t.db.update(scheduledEvents).set({ status: "canceled", canceledAt }).where(eq(scheduledEvents.id, m.scheduledEvent.id));
    await subs["booking.canceled"]!(
      domainEvent("booking.canceled", { scheduledEventId: m.scheduledEvent.id, inviteeId: m.invitee!.id, cancelerType: "invitee", reason: null, meetingCanceled: true }),
      jobCtx(t.db),
    );
    const rows = await executionsWhere(t.db, eq(workflowExecutions.inviteeId, m.invitee!.id));
    expect(rows.find((r) => r.id === pending!.id)).toMatchObject({ status: "canceled", skipReason: "meeting_canceled" });
    expect((await jobOf(t.db, pending!.id))?.status).toBe("canceled");
    const onCancel = rows.find((r) => r.trigger === "canceled");
    expect(onCancel).toMatchObject({ status: "scheduled" });
    expect(Math.abs(onCancel!.runAt.getTime() - canceledAt.getTime())).toBeLessThan(MINUTE);
  });

  it("an invitee leaving a group slot keeps the slot's host reminder; no canceled trigger for groups", async () => {
    const { owner, eventType } = await setupOwner(t.db, { eventType: { kind: "group", maxInvitees: 5 } });
    await reminderWorkflow(owner, eventType.id, { action: "email_host" });
    await reminderWorkflow(owner, eventType.id, { trigger: "canceled", offset: 0 });
    const m = await book(t.db, eventType, 3 * DAY, {}, { invitees: [{ name: "A One" }, { name: "B Two" }] });
    for (const i of m.invitees) await created(m.scheduledEvent.id, i.id);
    const slot = await executionsWhere(t.db, and(eq(workflowExecutions.scheduledEventId, m.scheduledEvent.id), eq(workflowExecutions.status, "scheduled")));
    expect(slot).toEqual([expect.objectContaining({ inviteeId: null, idempotencyKey: expect.stringContaining(`slot:${m.scheduledEvent.id}`) })]);
    const leaving = m.invitees[0]!;
    await t.db.update(invitees).set({ status: "canceled", canceledAt: new Date() }).where(eq(invitees.id, leaving.id));
    await subs["booking.canceled"]!(
      domainEvent("booking.canceled", { scheduledEventId: m.scheduledEvent.id, inviteeId: leaving.id, cancelerType: "invitee", reason: null, meetingCanceled: false }),
      jobCtx(t.db),
    );
    expect(await executionsWhere(t.db, and(eq(workflowExecutions.trigger, "canceled"), eq(workflowExecutions.scheduledEventId, m.scheduledEvent.id)))).toEqual([]);
    expect(await executionsWhere(t.db, and(eq(workflowExecutions.scheduledEventId, m.scheduledEvent.id), eq(workflowExecutions.status, "scheduled")))).toHaveLength(1);
  });
});

describe("booking.rescheduled", () => {
  it("cancels the old invitee's executions and schedules the new invitee plus Event is rescheduled ones", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    const { steps } = await reminderWorkflow(owner, eventType.id);
    await reminderWorkflow(owner, eventType.id, { trigger: "rescheduled", offset: 0 });
    const old = await book(t.db, eventType, 3 * DAY);
    await created(old.scheduledEvent.id, old.invitee!.id);
    const [oldExec] = await scheduledFor(t.db, old.invitee!.id);
    // Edit the workflow before the reschedule: the new invitee uses the current config.
    await t.db.update(workflowSteps).set({ subject: "Updated subject" }).where(eq(workflowSteps.id, steps[0]!.id));
    const next = await book(t.db, eventType, 5 * DAY);
    await t.db.update(invitees).set({ status: "canceled", rescheduled: true, newInviteeId: next.invitee!.id }).where(eq(invitees.id, old.invitee!.id));
    await t.db.update(scheduledEvents).set({ status: "canceled" }).where(eq(scheduledEvents.id, old.scheduledEvent.id));
    await subs["booking.rescheduled"]!(
      domainEvent("booking.rescheduled", {
        oldInviteeId: old.invitee!.id,
        newInviteeId: next.invitee!.id,
        oldScheduledEventId: old.scheduledEvent.id,
        newScheduledEventId: next.scheduledEvent.id,
        reason: null,
      }),
      jobCtx(t.db),
    );
    expect((await executionsWhere(t.db, eq(workflowExecutions.id, oldExec!.id)))[0]).toMatchObject({ status: "canceled", skipReason: "rescheduled" });
    expect(await executionsWhere(t.db, and(eq(workflowExecutions.trigger, "canceled"), eq(workflowExecutions.inviteeId, old.invitee!.id)))).toEqual([]);
    const fresh = await scheduledFor(t.db, next.invitee!.id);
    expect(fresh.map((e) => e.trigger).sort()).toEqual(["before_start", "rescheduled"]);
    const reminder = fresh.find((e) => e.trigger === "before_start")!;
    expect(reminder.runAt.getTime()).toBe(next.scheduledEvent.startAt.getTime() - DAY);
    expect(reminder.snapshot.subject).toBe("Updated subject");
  });

  it("re-times executions when the meeting moved in place (same invitee)", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    await reminderWorkflow(owner, eventType.id);
    const m = await book(t.db, eventType, 3 * DAY);
    await created(m.scheduledEvent.id, m.invitee!.id);
    const [e] = await scheduledFor(t.db, m.invitee!.id);
    const newStart = new Date(m.scheduledEvent.startAt.getTime() + DAY);
    await t.db.update(scheduledEvents).set({ startAt: newStart, endAt: new Date(newStart.getTime() + 30 * MINUTE) }).where(eq(scheduledEvents.id, m.scheduledEvent.id));
    await subs["booking.rescheduled"]!(
      domainEvent("booking.rescheduled", {
        oldInviteeId: m.invitee!.id,
        newInviteeId: m.invitee!.id,
        oldScheduledEventId: m.scheduledEvent.id,
        newScheduledEventId: m.scheduledEvent.id,
        reason: null,
      }),
      jobCtx(t.db),
    );
    const [moved] = await scheduledFor(t.db, m.invitee!.id);
    expect(moved!.id).toBe(e!.id);
    expect(moved!.runAt.getTime()).toBe(newStart.getTime() - DAY);
    const job = await jobOf(t.db, e!.id);
    expect(job).toMatchObject({ status: "pending" });
    expect(job!.runAt.getTime()).toBe(newStart.getTime() - DAY);
  });
});

describe("booking.no_show_created", () => {
  it("schedules No-show marked executions for the invitee", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    await reminderWorkflow(owner, eventType.id, { trigger: "no_show", offset: 60 });
    const m = await book(t.db, eventType, -2 * HOUR);
    const noShow = await f.markNoShow(t.db, m.invitee!.id, owner.id);
    await subs["booking.no_show_created"]!(domainEvent("booking.no_show_created", { inviteeId: m.invitee!.id, noShowId: noShow.id }), jobCtx(t.db));
    const [e] = await scheduledFor(t.db, m.invitee!.id);
    expect(e).toMatchObject({ trigger: "no_show" });
    expect(Math.abs(e!.runAt.getTime() - (noShow.createdAt.getTime() + HOUR))).toBeLessThan(MINUTE);
  });
});

describe("wiring", () => {
  it("publishEvent fans out to the workflows subscriber and the registered jobs run it", async () => {
    const { publishEvent } = await import("@/lib/events");
    const { runDueJobs } = await import("@/lib/jobs");
    const { owner, eventType } = await setupOwner(t.db);
    await reminderWorkflow(owner, eventType.id);
    const m = await book(t.db, eventType, 3 * DAY);
    await t.db.transaction((tx) =>
      publishEvent(tx, "booking.created", { scheduledEventId: m.scheduledEvent.id, inviteeId: m.invitee!.id, source: "booking_page" }, { organizationId: owner.organizationId }),
    );
    const ran = await runDueJobs({ budgetMs: 20_000, types: ["event:booking.created:workflows"] });
    expect(ran.succeeded).toBeGreaterThanOrEqual(1);
    expect(await scheduledFor(t.db, m.invitee!.id)).toHaveLength(1);
    const { getJobHandler } = await import("@/lib/jobs/registry");
    expect(getJobHandler("workflows.execute")).toBeTypeOf("function");
    expect(getJobHandler("workflows.backfill")).toBeTypeOf("function");
  });
});
