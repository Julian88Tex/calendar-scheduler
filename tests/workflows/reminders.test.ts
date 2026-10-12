// Event type reminders (SPEC NT-09, ET-25, NT-11, NT-13, NT-15 backfill, NT-24, ADM-10) on PGlite: the basic "Email
// reminders" rows and the per event type "Email reminder to host" workflows, their backfill, toggles, re-timing,
// authorization, limits and the demo seed.
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { jobs, workflowEventTypes, workflowExecutions, workflowSteps, workflows } from "@/db/schema";
import { loadActorCtx } from "@/lib/authz";
import { resetFakeTime } from "@/lib/time/now";
import { getEventTypeReminders, saveEventTypeReminders, setEventTypeRemindersEnabled } from "@/lib/workflows/reminders";
import { seedDemo } from "@/lib/workflows/seed";
import { workflowSubscribers } from "@/lib/workflows/subscriber-handlers";
import * as f from "../factories";
import { useTestDb } from "../helpers/db";
import { book, DAY, domainEvent, executionsWhere, HOUR, jobCtx, runWorkflowJobs, scheduledFor, setupOwner } from "./helpers";

const t = useTestDb();

afterEach(() => resetFakeTime());

type SaveInput = Parameters<typeof saveEventTypeReminders>[1];
const saveInput = (eventTypeId: string, over: Partial<SaveInput> = {}): SaveInput => ({
  eventTypeId,
  kind: "invitee",
  enabled: true,
  timings: [{ amount: 24, unit: "hours" }],
  subject: null,
  bodyHtml: null,
  includeCancelRescheduleLinks: true,
  ...over,
});

describe("the reminders view", () => {
  it("starts with both rows off and the Calendly defaults", async () => {
    const { actor, eventType } = await setupOwner(t.db);
    const view = await getEventTypeReminders(actor, eventType.id, t.db);
    expect(view).toMatchObject({ eventTypeId: eventType.id, eventTypeName: "30 Minute Virtual", canEdit: true, readOnlyReason: null });
    expect(view.invitee).toMatchObject({ enabled: false, configured: false, offsets: [], subject: null, bodyHtml: null, scheduledMeetings: 0 });
    expect(view.host).toMatchObject({ enabled: false, configured: false, includeCancelRescheduleLinks: false });
    expect(view.defaults.invitee.subject).toBe("Reminder: {{event_name}} with {{my_name}} at {{event_time}} {{event_date}}");
    expect(view.defaults.invitee.bodyHtml).toBe(
      "<p>Hi {{invitee_first_name}},</p><p>This is a friendly reminder that {{event_name}} with {{my_name}} is at {{event_time}} on {{event_date}}.</p>",
    );
    expect(view.defaults.host.subject).toBe("Reminder: {{event_name}} with {{invitee_full_name}} at {{event_time}} {{event_date}}");
    expect(view.variables.map((v) => v.key)).toContain("cancel_url");
    expect(view.variables.map((v) => v.key)).not.toContain("invitee_phone_number");
    expect(view.delivery.cronUrl).toBe("http://localhost:3000/api/cron");
  });

  it("is forbidden for users of another organization and read only for adhoc types", async () => {
    const { eventType } = await setupOwner(t.db);
    const stranger = await f.createUser(t.db);
    const strangerCtx = await loadActorCtx(t.db, stranger);
    await expect(getEventTypeReminders(strangerCtx, eventType.id, t.db)).rejects.toMatchObject({ code: "forbidden" });
    await expect(setEventTypeRemindersEnabled(strangerCtx, { eventTypeId: eventType.id, kind: "invitee", enabled: true }, t.db)).rejects.toMatchObject({
      code: "forbidden",
    });
    const { actor, owner } = await setupOwner(t.db);
    const { eventType: adhoc } = await f.createEventType(t.db, { owner, type: "adhoc" });
    const view = await getEventTypeReminders(actor, adhoc.id, t.db);
    expect(view.canEdit).toBe(false);
    expect(view.readOnlyReason).toBe("Reminders aren't available for this event type.");
    await expect(setEventTypeRemindersEnabled(actor, { eventTypeId: adhoc.id, kind: "invitee", enabled: true }, t.db)).rejects.toMatchObject({
      code: "validation",
    });
  });
});

describe("Email reminders (basic notification)", () => {
  it("turning on creates the basic workflow 24 hours before and backfills meetings more than 24 hours away (ET-25)", async () => {
    const { actor, eventType } = await setupOwner(t.db);
    const inThreeDays = await book(t.db, eventType, 3 * DAY);
    const inTwoHours = await book(t.db, eventType, 2 * HOUR);
    const result = await setEventTypeRemindersEnabled(actor, { eventTypeId: eventType.id, kind: "invitee", enabled: true }, t.db);
    expect(result.backfillJobs).toBe(1);
    expect(result.view.invitee).toMatchObject({ enabled: true, configured: true, offsets: [1440] });

    const [row] = await t.db.select().from(workflows).where(eq(workflows.basicEventTypeId, eventType.id));
    expect(row).toMatchObject({ isBasic: true, basicKind: "email_reminder", trigger: "before_start", offsetMinutes: 1440, active: true, deletedAt: null });
    const [step] = await t.db.select().from(workflowSteps).where(eq(workflowSteps.workflowId, row!.id));
    expect(step).toMatchObject({ action: "email_invitees", subject: null, bodyHtml: null, includeCancelRescheduleLinks: true });

    await runWorkflowJobs(t.db);
    const scheduled = await scheduledFor(t.db, inThreeDays.invitee!.id);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.runAt.getTime()).toBe(inThreeDays.scheduledEvent.startAt.getTime() - DAY);
    expect(await executionsWhere(t.db, eq(workflowExecutions.inviteeId, inTwoHours.invitee!.id))).toHaveLength(0);

    // New bookings get the reminder at booking time (subscriber).
    const later = await book(t.db, eventType, 5 * DAY);
    await workflowSubscribers["booking.created"]!(
      domainEvent("booking.created", { scheduledEventId: later.scheduledEvent.id, inviteeId: later.invitee!.id, source: "booking_page" }),
      jobCtx(t.db),
    );
    const next = await scheduledFor(t.db, later.invitee!.id);
    expect(next).toHaveLength(1);
    expect(next[0]!.runAt.getTime()).toBe(later.scheduledEvent.startAt.getTime() - DAY);
    const view = await getEventTypeReminders(actor, eventType.id, t.db);
    expect(view.invitee.scheduledMeetings).toBe(2);
  });

  it("turning it off and on again leaves exactly one scheduled reminder", async () => {
    const { actor, eventType } = await setupOwner(t.db);
    const meeting = await book(t.db, eventType, 3 * DAY);
    await setEventTypeRemindersEnabled(actor, { eventTypeId: eventType.id, kind: "invitee", enabled: true }, t.db);
    await runWorkflowJobs(t.db);
    const first = await scheduledFor(t.db, meeting.invitee!.id);
    expect(first).toHaveLength(1);

    const off = await setEventTypeRemindersEnabled(actor, { eventTypeId: eventType.id, kind: "invitee", enabled: false }, t.db);
    expect(off.backfillJobs).toBe(0);
    expect(off.view.invitee.enabled).toBe(false);
    // Off keeps the reminder scheduled (it would skip at send time while off).
    expect(await scheduledFor(t.db, meeting.invitee!.id)).toHaveLength(1);

    const on = await setEventTypeRemindersEnabled(actor, { eventTypeId: eventType.id, kind: "invitee", enabled: true }, t.db);
    expect(on.backfillJobs).toBe(1);
    await runWorkflowJobs(t.db);
    const again = await executionsWhere(t.db, eq(workflowExecutions.inviteeId, meeting.invitee!.id));
    expect(again).toHaveLength(1);
    expect(again[0]!.id).toBe(first[0]!.id);
    expect(again[0]!.status).toBe("scheduled");
  });

  it("saves up to 3 timings, re-times by canceling and backfilling, and revives a timing added back", async () => {
    const { actor, eventType } = await setupOwner(t.db);
    const meeting = await book(t.db, eventType, 4 * DAY);
    const r1 = await saveEventTypeReminders(
      actor,
      saveInput(eventType.id, { timings: [{ amount: 1, unit: "hours" }, { amount: 24, unit: "hours" }, { amount: 15, unit: "minutes" }] }),
      t.db,
    );
    expect(r1.view.invitee.offsets).toEqual([1440, 60, 15]);
    expect(r1.backfillJobs).toBe(3);
    await runWorkflowJobs(t.db);
    const three = await scheduledFor(t.db, meeting.invitee!.id);
    expect(three.map((e) => e.snapshot.offsetMinutes).sort((a, b) => b - a)).toEqual([1440, 60, 15]);
    const oneHour = three.find((e) => e.snapshot.offsetMinutes === 60)!;

    // 24 hours becomes 2 hours; 15 minutes is removed.
    const r2 = await saveEventTypeReminders(actor, saveInput(eventType.id, { timings: [{ amount: 2, unit: "hours" }, { amount: 1, unit: "hours" }] }), t.db);
    expect(r2.view.invitee.offsets).toEqual([120, 60]);
    expect(r2.backfillJobs).toBe(1);
    await runWorkflowJobs(t.db);
    const after = await executionsWhere(t.db, eq(workflowExecutions.inviteeId, meeting.invitee!.id));
    const byOffset = (m: number) => after.filter((e) => e.snapshot.offsetMinutes === m);
    expect(byOffset(1440)).toEqual([expect.objectContaining({ status: "canceled", skipReason: "unassigned" })]);
    expect(byOffset(15)).toEqual([expect.objectContaining({ status: "canceled", skipReason: "unassigned" })]);
    expect(byOffset(120)).toEqual([expect.objectContaining({ status: "scheduled" })]);
    expect(byOffset(60)).toEqual([expect.objectContaining({ id: oneHour.id, status: "scheduled" })]);
    // The canceled reminders' jobs are canceled too.
    const canceledJobs = await t.db.select().from(jobs).where(eq(jobs.type, "workflows.execute"));
    expect(canceledJobs.filter((j) => j.status === "canceled")).toHaveLength(2);

    // Adding 24 hours back revives its reminder (same row), never a duplicate.
    await saveEventTypeReminders(actor, saveInput(eventType.id, { timings: [{ amount: 24, unit: "hours" }, { amount: 1, unit: "hours" }] }), t.db);
    await runWorkflowJobs(t.db);
    const revived = (await executionsWhere(t.db, eq(workflowExecutions.inviteeId, meeting.invitee!.id))).filter((e) => e.snapshot.offsetMinutes === 1440);
    expect(revived).toEqual([expect.objectContaining({ status: "scheduled", skipReason: null })]);
    const live = await t.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.basicEventTypeId, eventType.id), isNull(workflows.deletedAt)));
    expect(live.map((w) => w.offsetMinutes).sort((a, b) => b - a)).toEqual([1440, 60]);
  });

  it("accepts 365 days and rejects 366 days (NT-11)", async () => {
    const { actor, eventType } = await setupOwner(t.db);
    const ok = await saveEventTypeReminders(actor, saveInput(eventType.id, { timings: [{ amount: 365, unit: "days" }] }), t.db);
    expect(ok.view.invitee.offsets).toEqual([525600]);
    // The schema rejects 366 days before the service runs; the database check is the last line of defense.
    const { SaveRemindersSchema } = await import("@/lib/workflows/schemas");
    const parsed = SaveRemindersSchema.safeParse(saveInput(eventType.id, { timings: [{ amount: 366, unit: "days" }] }));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Choose a time up to 365 days.");
  });

  it("stores the defaults as null, sanitizes custom messages and snapshots them per meeting", async () => {
    const { actor, eventType } = await setupOwner(t.db);
    const view = await getEventTypeReminders(actor, eventType.id, t.db);
    const same = await saveEventTypeReminders(
      actor,
      saveInput(eventType.id, { subject: ` ${view.defaults.invitee.subject} `, bodyHtml: view.defaults.invitee.bodyHtml }),
      t.db,
    );
    expect(same.view.invitee).toMatchObject({ subject: null, bodyHtml: null });

    const custom = await saveEventTypeReminders(
      actor,
      saveInput(eventType.id, {
        subject: "See you soon, {{invitee_first_name}}",
        bodyHtml: '<p>Bring your notes.</p><script>alert(1)</script><img src=x onerror="alert(1)">',
        includeCancelRescheduleLinks: false,
      }),
      t.db,
    );
    expect(custom.view.invitee.subject).toBe("See you soon, {{invitee_first_name}}");
    expect(custom.view.invitee.bodyHtml).toBe("<p>Bring your notes.</p>");
    expect(custom.view.invitee.includeCancelRescheduleLinks).toBe(false);

    await expect(saveEventTypeReminders(actor, saveInput(eventType.id, { subject: "   " }), t.db)).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { subject: ["Enter an email subject."] },
    });
    await expect(saveEventTypeReminders(actor, saveInput(eventType.id, { bodyHtml: "<p> </p>" }), t.db)).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { bodyHtml: ["Enter an email message."] },
    });
    const long = `<p>${"a".repeat(20_001)}</p>`;
    await expect(saveEventTypeReminders(actor, saveInput(eventType.id, { bodyHtml: long }), t.db)).rejects.toMatchObject({
      fieldErrors: { bodyHtml: ["Email messages can be up to 20,000 characters."] },
    });
  });
});

describe("Email reminders to host", () => {
  it("creates an Email reminder to host workflow assigned to the event type", async () => {
    const { actor, eventType, owner } = await setupOwner(t.db);
    const meeting = await book(t.db, eventType, 2 * DAY);
    const r = await saveEventTypeReminders(actor, saveInput(eventType.id, { kind: "host", timings: [{ amount: 30, unit: "minutes" }] }), t.db);
    expect(r.view.host).toMatchObject({ enabled: true, offsets: [30], includeCancelRescheduleLinks: false });
    expect(r.view.invitee.configured).toBe(false);
    const [row] = await t.db.select().from(workflows).where(eq(workflows.ownerUserId, owner.id));
    expect(row).toMatchObject({ isBasic: false, templateKey: "event_type_host_reminder", name: "Email reminder to host", basicEventTypeId: null });
    expect(await t.db.select().from(workflowEventTypes).where(eq(workflowEventTypes.workflowId, row!.id))).toEqual([
      expect.objectContaining({ eventTypeId: eventType.id }),
    ]);
    const [step] = await t.db.select().from(workflowSteps).where(eq(workflowSteps.workflowId, row!.id));
    expect(step?.action).toBe("email_host");
    await runWorkflowJobs(t.db);
    const scheduled = await scheduledFor(t.db, meeting.invitee!.id);
    expect(scheduled).toEqual([expect.objectContaining({ trigger: "before_start" })]);
    expect(scheduled[0]!.snapshot).toMatchObject({ action: "email_host", workflowName: "Email reminder to host", isBasic: false });
  });

  it("invitee and host reminders may share a timing", async () => {
    const { actor, eventType } = await setupOwner(t.db);
    await saveEventTypeReminders(actor, saveInput(eventType.id), t.db);
    const r = await saveEventTypeReminders(actor, saveInput(eventType.id, { kind: "host" }), t.db);
    expect(r.view.invitee.offsets).toEqual([1440]);
    expect(r.view.host.offsets).toEqual([1440]);
  });

  it("counts toward the 50 workflows limit (NT-24)", async () => {
    const { actor, eventType, owner } = await setupOwner(t.db);
    for (let i = 0; i < 50; i++) await f.createWorkflow(t.db, { owner, name: `W${i}` });
    await expect(setEventTypeRemindersEnabled(actor, { eventTypeId: eventType.id, kind: "host", enabled: true }, t.db)).rejects.toMatchObject({
      code: "validation",
      message: "You can have up to 50 workflows.",
    });
    // Basic notifications do not count.
    const ok = await setEventTypeRemindersEnabled(actor, { eventTypeId: eventType.id, kind: "invitee", enabled: true }, t.db);
    expect(ok.view.invitee.enabled).toBe(true);
  });
});

describe("seedDemo (ADM-10)", () => {
  it("creates one 24 hour reminder per demo event type idempotently and backfills the demo meetings", async () => {
    const { owner, eventType } = await setupOwner(t.db);
    const { eventType: second } = await f.createEventType(t.db, { owner, name: "60 Minute Virtual", durationMinutes: 60 });
    const meeting = await book(t.db, eventType, 3 * DAY);
    const ctx = { ownerUserId: owner.id, organizationId: owner.organizationId, eventTypeIds: [eventType.id, second.id] };
    await t.db.transaction((tx) => seedDemo(tx, ctx));
    await runWorkflowJobs(t.db);
    await t.db.transaction((tx) => seedDemo(tx, ctx));
    await runWorkflowJobs(t.db);
    const rows = await t.db.select().from(workflows).where(and(eq(workflows.ownerUserId, owner.id), isNull(workflows.deletedAt)));
    expect(rows).toHaveLength(2);
    expect(rows.every((w) => w.isBasic && w.offsetMinutes === 1440 && w.active)).toBe(true);
    const steps = await t.db.select().from(workflowSteps);
    expect(steps.filter((s) => rows.some((w) => w.id === s.workflowId))).toHaveLength(2);
    expect(await executionsWhere(t.db, eq(workflowExecutions.inviteeId, meeting.invitee!.id))).toHaveLength(1);
  });
});
