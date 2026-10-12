// The workflows.execute handler (SPEC NT-15, NT-19, NT-20, NT-23) on PGlite: eligibility re-checks at send time,
// Calendly-style reminder emails in the recipient's zone with the Cancel and Reschedule links, host reminders,
// custom messages, re-timing after in-place moves, the too_late rule, idempotency and the meeting activity log.
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { inviteeGuests, invitees, scheduledEvents, users, workflowExecutions, workflowSteps, workflows } from "@/db/schema";
import { resetFakeTime, setFakeNow } from "@/lib/time/now";
import { formatDateLong, formatTime } from "@/lib/time/format";
import { executeWorkflowJob } from "@/lib/workflows/execute";
import { saveEventTypeReminders, setEventTypeRemindersEnabled } from "@/lib/workflows/reminders";
import { workflowSubscribers as subs } from "@/lib/workflows/subscriber-handlers";
import * as f from "../factories";
import { useTestDb } from "../helpers/db";
import { activityOf, book, DAY, domainEvent, executionsWhere, HOUR, jobCtx, jobOf, MINUTE, outboxFor, runWorkflowJobs, scheduledFor, setupOwner } from "./helpers";

const t = useTestDb();

afterEach(() => resetFakeTime());

async function bookWithReminder(opts: { offsetHours?: number; startInMs?: number; kind?: "invitee" | "host"; links?: boolean } = {}) {
  const fx = await setupOwner(t.db);
  await t.db.update(users).set({ email: `julian.${f.uniq("h")}@example.com` }).where(eq(users.id, fx.owner.id));
  await saveEventTypeReminders(
    fx.actor,
    {
      eventTypeId: fx.eventType.id,
      kind: opts.kind ?? "invitee",
      enabled: true,
      timings: [{ amount: opts.offsetHours ?? 24, unit: "hours" }],
      subject: null,
      bodyHtml: null,
      includeCancelRescheduleLinks: opts.links ?? true,
    },
    t.db,
  );
  const m = await book(t.db, fx.eventType, opts.startInMs ?? 3 * DAY, { name: "Sam Rivera", timezone: "America/New_York" });
  await subs["booking.created"]!(domainEvent("booking.created", { scheduledEventId: m.scheduledEvent.id, inviteeId: m.invitee!.id, source: "booking_page" }), jobCtx(t.db));
  const [execution] = await scheduledFor(t.db, m.invitee!.id);
  const [host] = await t.db.select().from(users).where(eq(users.id, fx.owner.id));
  return { ...fx, host: host!, meeting: m, execution: execution! };
}

/** Moves the business clock to just after the execution's run time and runs due workflow jobs. */
async function runAt(at: Date) {
  setFakeNow(new Date(at.getTime() + 1000));
  await runWorkflowJobs(t.db);
}

describe("invitee reminders", () => {
  it("sends the Calendly reminder in the invitee's zone with Cancel and Reschedule links", async () => {
    const { meeting, execution, host } = await bookWithReminder();
    await runAt(execution.runAt);
    const [row] = await executionsWhere(t.db, eq(workflowExecutions.id, execution.id));
    expect(row).toMatchObject({ status: "sent", skipReason: null });
    expect(row!.sentAt).toBeInstanceOf(Date);
    const [email] = await outboxFor(t.db, execution.id);
    expect(row!.emailOutboxId).toBe(email!.id);
    const start = meeting.scheduledEvent.startAt;
    const time = formatTime(start, "America/New_York", "en", true);
    const date = formatDateLong(start, "America/New_York", "en");
    expect(email).toMatchObject({
      toAddresses: [meeting.invitee!.email],
      subject: `Reminder: 30 Minute Virtual with Julian Joseph at ${time} ${date}`,
      template: "workflows.invitee_reminder",
      category: "workflow",
      fromName: "Julian Joseph via Kairos",
      replyTo: host.email,
      scheduledEventId: meeting.scheduledEvent.id,
      inviteeId: meeting.invitee!.id,
    });
    expect(email!.text).toContain("Hi Sam,");
    expect(email!.text).toContain(`This is a friendly reminder that 30 Minute Virtual with Julian Joseph is at ${time} on ${date}.`);
    expect(email!.text).toContain("Need to make changes to this event?");
    expect(email!.html).toContain(`http://localhost:3000/cancellations/${meeting.invitee!.id}`);
    expect(email!.html).toContain(`http://localhost:3000/reschedulings/${meeting.invitee!.id}`);
    expect(email!.ics).toBeNull();
    const activity = await activityOf(t.db, meeting.scheduledEvent.id);
    expect(activity.at(-1)).toMatchObject({
      type: "workflow_sent",
      inviteeId: meeting.invitee!.id,
      data: expect.objectContaining({ executionId: execution.id, recipients: [meeting.invitee!.email], workflowName: "Email reminder to invitees" }),
    });
  });

  it("omits the links when the reminder turns them off and renders custom messages with variables", async () => {
    const { actor, eventType, meeting, execution } = await bookWithReminder({ links: false });
    await runAt(execution.runAt);
    const [plain] = await outboxFor(t.db, execution.id);
    expect(plain!.html).not.toContain("/cancellations/");
    expect(plain!.text).not.toContain("Need to make changes");

    await saveEventTypeReminders(
      actor,
      {
        eventTypeId: eventType.id,
        kind: "invitee",
        enabled: true,
        timings: [{ amount: 24, unit: "hours" }],
        subject: "See you soon, {{invitee_first_name}}",
        bodyHtml: '<p>Hi {{invitee_first_name}}, your link: <a href="https://example.com/prep">prep notes</a></p>',
        includeCancelRescheduleLinks: true,
      },
      t.db,
    );
    resetFakeTime();
    const next = await book(t.db, eventType, 3 * DAY, { name: "Ana <b>Lima</b>" });
    await subs["booking.created"]!(domainEvent("booking.created", { scheduledEventId: next.scheduledEvent.id, inviteeId: next.invitee!.id, source: "booking_page" }), jobCtx(t.db));
    const [e2] = await scheduledFor(t.db, next.invitee!.id);
    await runAt(e2!.runAt);
    const [custom] = await outboxFor(t.db, e2!.id);
    expect(custom!.subject).toBe("See you soon, Ana");
    expect(custom!.html).toContain("Hi Ana, your link:");
    expect(custom!.html).toContain('href="https://example.com/prep"');
    expect(custom!.html).toContain(`/reschedulings/${next.invitee!.id}`);
    expect(meeting).toBeTruthy();
  });

  it("omits the links when the event type turned them off for its emails and reminders", async () => {
    const { meeting, execution } = await bookWithReminder();
    await t.db
      .update(scheduledEvents)
      .set({ settingsSnapshot: { ...meeting.scheduledEvent.settingsSnapshot, includeCancelRescheduleLinks: false } })
      .where(eq(scheduledEvents.id, meeting.scheduledEvent.id));
    await runAt(execution.runAt);
    const [email] = await outboxFor(t.db, execution.id);
    expect(email!.html).not.toContain("/cancellations/");
    expect(email!.html).not.toContain("/reschedulings/");
  });

  it("also sends guest copies without manage links when the action includes guests", async () => {
    const { meeting, execution } = await bookWithReminder();
    await t.db.insert(inviteeGuests).values({ inviteeId: meeting.invitee!.id, scheduledEventId: meeting.scheduledEvent.id, email: "guest@example.com", emailNormalized: "guest@example.com" });
    await t.db
      .update(workflowExecutions)
      .set({ snapshot: { ...execution.snapshot, includeGuests: true } })
      .where(eq(workflowExecutions.id, execution.id));
    await runAt(execution.runAt);
    const emails = await outboxFor(t.db, execution.id);
    expect(emails.map((e) => e.toAddresses[0]).sort()).toEqual([meeting.invitee!.email, "guest@example.com"].sort());
    const guest = emails.find((e) => e.toAddresses[0] === "guest@example.com")!;
    expect(guest.text).toContain("Hi,");
    expect(guest.html).not.toContain("/cancellations/");
  });
});

describe("host reminders", () => {
  it("emails the host in the host's zone with View event and Reply-To the invitee", async () => {
    const { meeting, execution, host } = await bookWithReminder({ kind: "host", offsetHours: 1 });
    await runAt(execution.runAt);
    const [email] = await outboxFor(t.db, execution.id);
    const time = formatTime(meeting.scheduledEvent.startAt, "America/Los_Angeles", "en", true);
    expect(email).toMatchObject({
      toAddresses: [host.email],
      template: "workflows.host_reminder",
      fromName: "Kairos",
      replyTo: meeting.invitee!.email,
      relatedUserId: host.id,
    });
    expect(email!.subject).toContain(`Reminder: 30 Minute Virtual with Sam Rivera at ${time}`);
    expect(email!.html).toContain(`/app/meetings?event=${meeting.scheduledEvent.id}`);
    expect(email!.html).not.toContain("/cancellations/");
  });
});

describe("group slots", () => {
  it("sends one slot host reminder naming the invitee count", async () => {
    const fx = await setupOwner(t.db, { eventType: { kind: "group", maxInvitees: 5, name: "Yoga Class" } });
    await saveEventTypeReminders(
      fx.actor,
      { eventTypeId: fx.eventType.id, kind: "host", enabled: true, timings: [{ amount: 1, unit: "hours" }], subject: null, bodyHtml: null, includeCancelRescheduleLinks: false },
      t.db,
    );
    const m = await book(t.db, fx.eventType, 2 * DAY, {}, { invitees: [{ name: "A One" }, { name: "B Two" }] });
    for (const i of m.invitees) {
      await subs["booking.created"]!(domainEvent("booking.created", { scheduledEventId: m.scheduledEvent.id, inviteeId: i.id, source: "booking_page" }), jobCtx(t.db));
    }
    const slot = await executionsWhere(t.db, eq(workflowExecutions.scheduledEventId, m.scheduledEvent.id));
    expect(slot).toHaveLength(1);
    await runAt(slot[0]!.runAt);
    const [email] = await outboxFor(t.db, slot[0]!.id);
    expect(email!.subject).toContain("Reminder: Yoga Class with 2 invitees at");
  });
});

describe("eligibility at send time", () => {
  it("skips while the reminder is off and records why", async () => {
    const { actor, eventType, meeting, execution } = await bookWithReminder();
    await setEventTypeRemindersEnabled(actor, { eventTypeId: eventType.id, kind: "invitee", enabled: false }, t.db);
    await runAt(execution.runAt);
    expect((await executionsWhere(t.db, eq(workflowExecutions.id, execution.id)))[0]).toMatchObject({ status: "skipped", skipReason: "workflow_off" });
    expect(await outboxFor(t.db, execution.id)).toEqual([]);
    expect((await activityOf(t.db, meeting.scheduledEvent.id)).at(-1)).toMatchObject({ type: "workflow_skipped", data: expect.objectContaining({ reason: "workflow_off" }) });
  });

  it("skips deleted workflows, canceled meetings and canceled invitees", async () => {
    const a = await bookWithReminder();
    await t.db.update(workflows).set({ deletedAt: new Date() }).where(eq(workflows.id, a.execution.workflowId!));
    const b = await bookWithReminder();
    await t.db.update(scheduledEvents).set({ status: "canceled" }).where(eq(scheduledEvents.id, b.meeting.scheduledEvent.id));
    const c = await bookWithReminder();
    await t.db.update(invitees).set({ status: "canceled" }).where(eq(invitees.id, c.meeting.invitee!.id));
    for (const x of [a, b, c]) await runAt(x.execution.runAt);
    const reason = async (id: string) => (await executionsWhere(t.db, eq(workflowExecutions.id, id)))[0]?.skipReason;
    expect(await reason(a.execution.id)).toBe("workflow_deleted");
    expect(await reason(b.execution.id)).toBe("meeting_canceled");
    expect(await reason(c.execution.id)).toBe("invitee_canceled");
  });

  it("skips a reminder whose meeting already started (too_late) but sends one that is late but still before the start", async () => {
    const late = await bookWithReminder({ offsetHours: 2 });
    setFakeNow(new Date(late.meeting.scheduledEvent.startAt.getTime() - 30 * MINUTE));
    await runWorkflowJobs(t.db);
    expect((await executionsWhere(t.db, eq(workflowExecutions.id, late.execution.id)))[0]?.status).toBe("sent");
    expect((await activityOf(t.db, late.meeting.scheduledEvent.id)).at(-1)?.data).toMatchObject({ lateMinutes: 90 });

    resetFakeTime();
    const tooLate = await bookWithReminder({ offsetHours: 2 });
    setFakeNow(new Date(tooLate.meeting.scheduledEvent.startAt.getTime() + MINUTE));
    await runWorkflowJobs(t.db);
    expect((await executionsWhere(t.db, eq(workflowExecutions.id, tooLate.execution.id)))[0]).toMatchObject({ status: "skipped", skipReason: "too_late" });
    expect(await outboxFor(t.db, tooLate.execution.id)).toEqual([]);
  });

  it("follows a meeting moved later in place: the job is re-timed, then sends at the new time", async () => {
    const { meeting, execution } = await bookWithReminder();
    const newStart = new Date(meeting.scheduledEvent.startAt.getTime() + DAY);
    await t.db.update(scheduledEvents).set({ startAt: newStart, endAt: new Date(newStart.getTime() + 30 * MINUTE) }).where(eq(scheduledEvents.id, meeting.scheduledEvent.id));
    await runAt(execution.runAt);
    const [moved] = await executionsWhere(t.db, eq(workflowExecutions.id, execution.id));
    expect(moved).toMatchObject({ status: "scheduled" });
    expect(moved!.runAt.getTime()).toBe(newStart.getTime() - DAY);
    const job = await jobOf(t.db, execution.id);
    expect(job?.status).toBe("pending");
    expect(Math.abs(job!.runAt.getTime() - (newStart.getTime() - DAY))).toBeLessThan(5 * MINUTE);
    await runAt(job!.runAt);
    expect((await executionsWhere(t.db, eq(workflowExecutions.id, execution.id)))[0]?.status).toBe("sent");
  });

  it("skips Event ends messages for no-shows (NT-19)", async () => {
    const fx = await setupOwner(t.db);
    await f.createWorkflow(t.db, { owner: fx.owner, trigger: "ends", offsetMinutes: 15, eventTypeIds: [fx.eventType.id], steps: [{ action: "email_invitees", subject: "Thanks", bodyHtml: "<p>Thanks!</p>" }] });
    const m = await book(t.db, fx.eventType, 2 * HOUR);
    await subs["booking.created"]!(domainEvent("booking.created", { scheduledEventId: m.scheduledEvent.id, inviteeId: m.invitee!.id, source: "booking_page" }), jobCtx(t.db));
    const [e] = await scheduledFor(t.db, m.invitee!.id);
    await f.markNoShow(t.db, m.invitee!.id, fx.owner.id);
    await runAt(e!.runAt);
    expect((await executionsWhere(t.db, eq(workflowExecutions.id, e!.id)))[0]).toMatchObject({ status: "skipped", skipReason: "no_show" });
  });

  it("sends to other emails and skips text actions in this build", async () => {
    const fx = await setupOwner(t.db);
    const { steps } = await f.createWorkflow(t.db, {
      owner: fx.owner,
      eventTypeIds: [fx.eventType.id],
      steps: [
        { action: "email_other", recipients: ["Assistant@Example.com", "not-an-email"], subject: "FYI {{invitee_full_name}}" },
        { action: "sms_invitees", bodyText: "Reminder" },
      ],
    });
    const m = await book(t.db, fx.eventType, 3 * DAY);
    await subs["booking.created"]!(domainEvent("booking.created", { scheduledEventId: m.scheduledEvent.id, inviteeId: m.invitee!.id, source: "booking_page" }), jobCtx(t.db));
    const rows = await scheduledFor(t.db, m.invitee!.id);
    await runAt(rows[0]!.runAt);
    const other = (await executionsWhere(t.db, eq(workflowExecutions.stepId, steps[0]!.id)))[0]!;
    const sms = (await executionsWhere(t.db, eq(workflowExecutions.stepId, steps[1]!.id)))[0]!;
    expect(other.status).toBe("sent");
    const [email] = await outboxFor(t.db, other.id);
    expect(email).toMatchObject({ toAddresses: ["assistant@example.com"], subject: "FYI Sam Rivera" });
    expect(email!.html).not.toContain("/cancellations/");
    expect(sms).toMatchObject({ status: "skipped", skipReason: "sms_unavailable" });
  });

  it("is idempotent: a second run of the same execution sends nothing more", async () => {
    const { execution } = await bookWithReminder();
    setFakeNow(new Date(execution.runAt.getTime() + 1000));
    const ctx = jobCtx(t.db);
    const first = await executeWorkflowJob({ executionId: execution.id }, ctx);
    const second = await executeWorkflowJob({ executionId: execution.id }, ctx);
    expect(first.result).toEqual({ status: "sent", recipients: 1 });
    expect(second.result).toEqual({ status: "noop", reason: "sent" });
    expect(await outboxFor(t.db, execution.id)).toHaveLength(1);
    await expect(executeWorkflowJob({ executionId: "nope" }, ctx)).rejects.toThrow("Malformed");
  });

  it("uses the step's frozen copy even when the workflow changed after scheduling", async () => {
    const { execution } = await bookWithReminder();
    await t.db.update(workflowSteps).set({ subject: "Changed later" }).where(eq(workflowSteps.workflowId, execution.workflowId!));
    await runAt(execution.runAt);
    const [email] = await outboxFor(t.db, execution.id);
    expect(email!.subject.startsWith("Reminder: 30 Minute Virtual")).toBe(true);
  });
});
