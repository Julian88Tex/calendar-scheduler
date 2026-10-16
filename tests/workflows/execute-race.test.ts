// workflows.execute against changes that land while the reminder is being rendered (SPEC NT-15 send-time re-checks):
// the meeting canceled, the invitee canceled or the reminder turned off between the first checks and the send must
// never produce an email. The template context builder is wrapped so a test can change the database mid-render.
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ duringRender: null as null | (() => Promise<void>) }));
vi.mock("@/lib/template-context", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/template-context")>();
  return {
    ...real,
    buildMeetingTemplateContext: async (...args: Parameters<typeof real.buildMeetingTemplateContext>) => {
      const ctx = await real.buildMeetingTemplateContext(...args);
      const hook = hooks.duringRender;
      hooks.duringRender = null;
      if (hook) await hook();
      return ctx;
    },
  };
});

const { invitees, scheduledEvents, workflowExecutions, workflows } = await import("@/db/schema");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { executeWorkflowJob } = await import("@/lib/workflows/execute");
const { saveEventTypeReminders } = await import("@/lib/workflows/reminders");
const { workflowSubscribers: subs } = await import("@/lib/workflows/subscriber-handlers");
const { useTestDb } = await import("../helpers/db");
const { activityOf, book, DAY, domainEvent, executionsWhere, jobCtx, outboxFor, scheduledFor, setupOwner } = await import("./helpers");

const t = useTestDb();

afterEach(() => {
  hooks.duringRender = null;
  resetFakeTime();
});

async function dueReminder() {
  const fx = await setupOwner(t.db);
  await saveEventTypeReminders(
    fx.actor,
    {
      eventTypeId: fx.eventType.id,
      kind: "invitee",
      enabled: true,
      timings: [{ amount: 24, unit: "hours" }],
      subject: null,
      bodyHtml: null,
      includeCancelRescheduleLinks: true,
    },
    t.db,
  );
  const meeting = await book(t.db, fx.eventType, 3 * DAY);
  await subs["booking.created"]!(
    domainEvent("booking.created", { scheduledEventId: meeting.scheduledEvent.id, inviteeId: meeting.invitee!.id, source: "booking_page" }),
    jobCtx(t.db),
  );
  const [execution] = await scheduledFor(t.db, meeting.invitee!.id);
  setFakeNow(new Date(execution!.runAt.getTime() + 1000));
  return { ...fx, meeting, execution: execution! };
}

describe("changes while a reminder is rendered", () => {
  it("a meeting canceled mid-render sends nothing and records the skip", async () => {
    const { meeting, execution } = await dueReminder();
    hooks.duringRender = async () => {
      await t.db.update(invitees).set({ status: "canceled", canceledAt: new Date() }).where(eq(invitees.id, meeting.invitee!.id));
      await t.db.update(scheduledEvents).set({ status: "canceled" }).where(eq(scheduledEvents.id, meeting.scheduledEvent.id));
    };
    const out = await executeWorkflowJob({ executionId: execution.id }, jobCtx(t.db));
    expect(out.result).toEqual({ status: "skipped", reason: "meeting_canceled" });
    expect(await outboxFor(t.db, execution.id)).toEqual([]);
    expect((await executionsWhere(t.db, eq(workflowExecutions.id, execution.id)))[0]).toMatchObject({ status: "skipped", skipReason: "meeting_canceled" });
    expect((await activityOf(t.db, meeting.scheduledEvent.id)).at(-1)).toMatchObject({ type: "workflow_skipped" });
  });

  it("an invitee canceled, or the reminder turned off, mid-render sends nothing", async () => {
    const a = await dueReminder();
    hooks.duringRender = async () => {
      await t.db.update(invitees).set({ status: "canceled" }).where(eq(invitees.id, a.meeting.invitee!.id));
    };
    expect((await executeWorkflowJob({ executionId: a.execution.id }, jobCtx(t.db))).result).toEqual({ status: "skipped", reason: "invitee_canceled" });
    expect(await outboxFor(t.db, a.execution.id)).toEqual([]);

    resetFakeTime();
    const b = await dueReminder();
    hooks.duringRender = async () => {
      await t.db.update(workflows).set({ active: false }).where(eq(workflows.id, b.execution.workflowId!));
    };
    expect((await executeWorkflowJob({ executionId: b.execution.id }, jobCtx(t.db))).result).toEqual({ status: "skipped", reason: "workflow_off" });
    expect(await outboxFor(t.db, b.execution.id)).toEqual([]);
  });

  it("an execution canceled by the cancellation subscriber mid-render is left as the subscriber wrote it", async () => {
    const { meeting, execution } = await dueReminder();
    hooks.duringRender = async () => {
      await t.db.update(invitees).set({ status: "canceled", canceledAt: new Date() }).where(eq(invitees.id, meeting.invitee!.id));
      await subs["booking.canceled"]!(
        domainEvent("booking.canceled", {
          scheduledEventId: meeting.scheduledEvent.id,
          inviteeId: meeting.invitee!.id,
          cancelerType: "invitee",
          reason: null,
          meetingCanceled: true,
        }),
        jobCtx(t.db),
      );
    };
    const out = await executeWorkflowJob({ executionId: execution.id }, jobCtx(t.db));
    expect(out.result).toEqual({ status: "noop", reason: "changed" });
    expect(await outboxFor(t.db, execution.id)).toEqual([]);
    expect((await executionsWhere(t.db, eq(workflowExecutions.id, execution.id)))[0]).toMatchObject({ status: "canceled", skipReason: "meeting_canceled" });
  });

  it("a send error is retried; when the last attempt fails the execution is marked failed and logged", async () => {
    const { meeting, execution } = await dueReminder();
    const attempt = (n: number) => Object.assign(jobCtx(t.db) as object, { attempt: n }) as never;
    hooks.duringRender = async () => {
      throw new Error("Template backend unavailable");
    };
    await expect(executeWorkflowJob({ executionId: execution.id }, attempt(1))).rejects.toThrow("Template backend unavailable");
    expect((await executionsWhere(t.db, eq(workflowExecutions.id, execution.id)))[0]).toMatchObject({ status: "scheduled", error: null });

    hooks.duringRender = async () => {
      throw new Error("Template backend unavailable");
    };
    await expect(executeWorkflowJob({ executionId: execution.id }, attempt(8))).rejects.toThrow("Template backend unavailable");
    expect((await executionsWhere(t.db, eq(workflowExecutions.id, execution.id)))[0]).toMatchObject({
      status: "failed",
      error: "Template backend unavailable",
    });
    expect((await activityOf(t.db, meeting.scheduledEvent.id)).at(-1)).toMatchObject({
      type: "email_failed",
      data: expect.objectContaining({ executionId: execution.id, error: "Template backend unavailable" }),
    });
    expect(await outboxFor(t.db, execution.id)).toEqual([]);
  });

  it("without changes the reminder still goes out", async () => {
    const { execution } = await dueReminder();
    expect((await executeWorkflowJob({ executionId: execution.id }, jobCtx(t.db))).result).toEqual({ status: "sent", recipients: 1 });
    expect(await outboxFor(t.db, execution.id)).toHaveLength(1);
  });
});
