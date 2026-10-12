// The workflows.execute job (SPEC NT-15, NT-19, NT-20, NT-23; ARCHITECTURE section 14): sends one scheduled
// execution after re-checking it against the current state:
// - the workflow still exists, is on and still applies to the meeting's event type;
// - the meeting and the invitee are still active (except for "Event is canceled" messages);
// - "Event ends" messages skip invitees marked as no-shows (NT-19);
// - timed messages follow the meeting if it moved in place (the job is re-timed with RetryLaterError);
// - reminders ("before event starts") still go out when late, but never once the meeting has started (too_late).
// Emails are rendered with buildMeetingTemplateContext for each recipient (their zone, time format and locale) and
// renderMeetingEmail (invitee_reminder / host_reminder: Calendly's reminder layout, custom subject and body when the
// host wrote them, the "Need to make changes to this event?" Cancel and Reschedule links for invitees), sent with
// sendEmail (idempotent per execution and recipient, so a retried job never sends twice) and recorded in the
// meeting activity. Text message actions are not available in this build and are skipped.
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { inviteeGuests, inviteeNoShows, invitees, scheduledEventHosts, scheduledEvents, users, workflowExecutions, workflows } from "@/db/schema";
import { emailBrandForUser, isValidEmailAddress, meetingSender, renderMeetingEmail, sendEmail, type MeetingEmailKind } from "@/lib/email";
import { sanitizeRichText } from "@/lib/html";
import { getT, resolveLocale } from "@/lib/i18n";
import { reminderDecision } from "@/lib/jobs/timing";
import { PermanentJobError, RetryLaterError, type JobContext } from "@/lib/jobs/types";
import { log } from "@/lib/logger";
import { buildMeetingTemplateContext } from "@/lib/template-context";
import { now as clockNow } from "@/lib/time/now";
import { absoluteUrl } from "@/lib/url";
import { currentRunAt, isSmsAction, type WorkflowAction } from "./engine";
import { recordActivity, workflowAppliesTo, type ExecutionRow } from "./store";

const Payload = z.object({ executionId: z.uuid() });

/** A re-timed job runs again when the meeting moved by more than this. */
const RETIME_TOLERANCE_MS = 60_000;

export type ExecuteOutcome =
  | { status: "sent"; recipients: number }
  | { status: "skipped"; reason: string }
  | { status: "noop"; reason: string };

type Recipient = {
  kind: "invitee" | "guest" | "host" | "other";
  email: string;
  /** Host recipients: whose zone and time format to use. */
  hostUserId?: string;
  /** Distinguishes recipients in the email idempotency key. */
  key: string;
};

async function markSkipped(db: DB, execution: ExecutionRow, reason: string, data: Record<string, unknown> = {}): Promise<ExecuteOutcome> {
  const at = clockNow();
  const rows = await db
    .update(workflowExecutions)
    .set({ status: "skipped", skipReason: reason, updatedAt: at })
    .where(and(eq(workflowExecutions.id, execution.id), eq(workflowExecutions.status, "scheduled")))
    .returning({ id: workflowExecutions.id });
  if (rows.length) {
    await recordActivity(db, [
      {
        scheduledEventId: execution.scheduledEventId,
        inviteeId: execution.inviteeId,
        type: "workflow_skipped",
        data: {
          executionId: execution.id,
          workflowId: execution.workflowId,
          workflowName: execution.snapshot.workflowName,
          action: execution.snapshot.action,
          trigger: execution.trigger,
          reason,
          ...data,
        },
      },
    ]);
  }
  return { status: "skipped", reason };
}

async function recipientsFor(
  db: DB,
  action: WorkflowAction,
  p: { execution: ExecutionRow; invitee: { id: string; email: string } | null; scheduledEventId: string },
): Promise<Recipient[]> {
  const snapshot = p.execution.snapshot;
  if (action === "email_invitees") {
    if (!p.invitee) return [];
    const out: Recipient[] = [{ kind: "invitee", email: p.invitee.email, key: "invitee" }];
    if (snapshot.includeGuests) {
      const guests = await db
        .select({ email: inviteeGuests.email })
        .from(inviteeGuests)
        .where(and(eq(inviteeGuests.inviteeId, p.invitee.id), isNull(inviteeGuests.canceledAt)))
        .orderBy(asc(inviteeGuests.createdAt));
      for (const g of guests) out.push({ kind: "guest", email: g.email, key: `guest:${g.email.toLowerCase()}` });
    }
    return out;
  }
  if (action === "email_host") {
    const hosts = await db
      .select({ userId: users.id, email: users.email, role: scheduledEventHosts.role })
      .from(scheduledEventHosts)
      .innerJoin(users, eq(users.id, scheduledEventHosts.userId))
      .where(eq(scheduledEventHosts.scheduledEventId, p.scheduledEventId))
      .orderBy(asc(scheduledEventHosts.createdAt));
    hosts.sort((a, b) => Number(b.role === "organizer") - Number(a.role === "organizer"));
    return hosts.map((h) => ({ kind: "host" as const, email: h.email, hostUserId: h.userId, key: `host:${h.userId}` }));
  }
  if (action === "email_other") {
    return [...new Set(snapshot.recipients.map((r) => r.trim().toLowerCase()))]
      .filter((r) => isValidEmailAddress(r))
      .slice(0, 10)
      .map((email) => ({ kind: "other" as const, email, key: `other:${email}` }));
  }
  return [];
}

/** Runs one workflows.execute job (see the file header). */
export async function executeWorkflowJob(payload: unknown, ctx: JobContext): Promise<{ result: ExecuteOutcome }> {
  const parsed = Payload.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError("Malformed workflows.execute payload");
  const db = ctx.db;
  const [row] = await db
    .select({ execution: workflowExecutions, event: scheduledEvents, workflow: workflows })
    .from(workflowExecutions)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, workflowExecutions.scheduledEventId))
    .leftJoin(workflows, eq(workflows.id, workflowExecutions.workflowId))
    .where(eq(workflowExecutions.id, parsed.data.executionId))
    .limit(1);
  if (!row) return { result: { status: "noop", reason: "missing" } };
  const { execution, event, workflow } = row;
  if (execution.status !== "scheduled") return { result: { status: "noop", reason: execution.status } };
  const snapshot = execution.snapshot;
  const at = clockNow();

  if (!workflow || workflow.deletedAt) return { result: await markSkipped(db, execution, "workflow_deleted") };
  if (!workflow.active) return { result: await markSkipped(db, execution, "workflow_off") };
  if (!(await workflowAppliesTo(db, workflow, event.eventTypeId))) return { result: await markSkipped(db, execution, "unassigned") };
  if (execution.trigger !== "canceled" && event.status !== "active") return { result: await markSkipped(db, execution, "meeting_canceled") };

  const invitee = execution.inviteeId
    ? ((await db.select().from(invitees).where(eq(invitees.id, execution.inviteeId)).limit(1))[0] ?? null)
    : null;
  if (execution.inviteeId && !invitee) return { result: await markSkipped(db, execution, "invitee_missing") };
  if (invitee && execution.trigger !== "canceled" && invitee.status !== "active") {
    return { result: await markSkipped(db, execution, "invitee_canceled") };
  }
  if (invitee && execution.trigger === "ends") {
    const [noShow] = await db.select({ id: inviteeNoShows.id }).from(inviteeNoShows).where(eq(inviteeNoShows.inviteeId, invitee.id)).limit(1);
    if (noShow) return { result: await markSkipped(db, execution, "no_show") };
  }

  // The meeting may have moved in place since the execution was scheduled: follow it.
  const expected = currentRunAt(execution.trigger, snapshot.offsetMinutes, event);
  if (expected && expected.getTime() - at.getTime() > RETIME_TOLERANCE_MS) {
    await db.update(workflowExecutions).set({ runAt: expected, updatedAt: at }).where(eq(workflowExecutions.id, execution.id));
    throw new RetryLaterError(expected.getTime() - at.getTime(), "The meeting moved; the message was re-timed");
  }
  let lateMs = 0;
  if (execution.trigger === "before_start") {
    const decision = reminderDecision({ meetingStartAt: event.startAt, dueAt: expected ?? execution.runAt, at });
    if (!decision.send) return { result: await markSkipped(db, execution, "too_late", { lateMs: decision.lateMs }) };
    lateMs = decision.lateMs;
    if (decision.late) log.warn("workflows.reminder_late", { executionId: execution.id, lateMinutes: Math.round(decision.lateMs / 60_000) });
  }

  const action = snapshot.action as WorkflowAction;
  if (isSmsAction(action)) return { result: await markSkipped(db, execution, "sms_unavailable") };
  const recipients = await recipientsFor(db, action, { execution, invitee, scheduledEventId: event.id });
  if (!recipients.length) return { result: await markSkipped(db, execution, "no_recipient") };

  const brand = await emailBrandForUser(event.organizerUserId, db);
  const meetingLocale = event.locale || event.settingsSnapshot?.locale || "en";
  const bodyTemplate = snapshot.bodyHtml ? sanitizeRichText(snapshot.bodyHtml) || null : null;
  const outboxIds: string[] = [];
  for (const r of recipients) {
    const recipient = r.kind === "host" ? "host" : r.kind === "other" ? "other" : "invitee";
    const vars = await buildMeetingTemplateContext({
      scheduledEventId: event.id,
      inviteeId: invitee?.id ?? null,
      recipient,
      hostUserId: r.hostUserId ?? null,
      db,
    });
    let ctxVars = vars;
    // Guests are greeted with "Hi," (the default greeting names the invitee).
    if (r.kind === "guest" && !bodyTemplate) ctxVars = { ...vars, invitee_first_name: "" };
    // Slot-level host reminders of group events name the slot's invitee count ("with 3 invitees").
    if (r.kind === "host" && !invitee) {
      const n = Number(vars.invitees_count ?? 0);
      ctxVars = { ...vars, invitee_full_name: `${n} ${n === 1 ? "invitee" : "invitees"}` };
    }
    const kind: MeetingEmailKind = r.kind === "host" ? "host_reminder" : "invitee_reminder";
    const locale = r.kind === "host" ? "en" : resolveLocale(r.kind === "other" ? meetingLocale : (invitee?.locale ?? meetingLocale));
    const email = renderMeetingEmail({
      kind,
      ctx: ctxVars,
      brand,
      locale,
      location: event.location,
      questions: invitee?.questionsAndAnswers ?? null,
      includeAnswers: event.settingsSnapshot?.includeAnswersInNotifications !== false,
      // The event type's "Include cancel and reschedule links in email invitations and reminders" (meeting snapshot)
      // and the reminder's own option must both allow them; never for guests, hosts or other recipients.
      manageLinks: r.kind === "invitee" && snapshot.includeCancelRescheduleLinks && event.settingsSnapshot?.includeCancelRescheduleLinks !== false,
      meetingUrl: r.kind === "host" ? absoluteUrl(`/app/meetings?event=${encodeURIComponent(event.id)}`) : null,
      // Default subjects come from the workflows namespace in the recipient's language (GEN-10).
      subjectTemplate: snapshot.subject ?? getT(locale, "workflows")(`reminders.${r.kind === "host" ? "host" : "invitee"}.subject`),
      bodyTemplate,
    });
    const sender =
      r.kind === "host"
        ? await meetingSender({ hostUserId: event.organizerUserId, audience: "host", replyTo: invitee?.email ?? null, db })
        : await meetingSender({ hostUserId: event.organizerUserId, audience: "invitee", replyTo: snapshot.replyTo ?? undefined, db });
    const sent = await sendEmail({
      to: [r.email],
      subject: email.subject,
      html: email.html,
      text: email.text,
      fromName: sender.fromName,
      replyTo: sender.replyTo,
      template: `workflows.${kind}`,
      category: "workflow",
      idempotencyKey: `workflow:${execution.id}:${r.key}`,
      related: {
        organizationId: event.organizationId,
        userId: r.hostUserId ?? event.organizerUserId,
        scheduledEventId: event.id,
        inviteeId: invitee?.id,
        workflowExecutionId: execution.id,
      },
    });
    outboxIds.push(sent.id);
  }

  const done = clockNow();
  const updated = await db
    .update(workflowExecutions)
    .set({ status: "sent", sentAt: done, emailOutboxId: outboxIds[0] ?? null, error: null, updatedAt: done })
    .where(and(eq(workflowExecutions.id, execution.id), eq(workflowExecutions.status, "scheduled")))
    .returning({ id: workflowExecutions.id });
  if (!updated.length) log.warn("workflows.execution_changed_while_sending", { executionId: execution.id });
  await recordActivity(db, [
    {
      scheduledEventId: event.id,
      inviteeId: execution.inviteeId,
      type: "workflow_sent",
      data: {
        executionId: execution.id,
        workflowId: execution.workflowId,
        workflowName: snapshot.workflowName,
        action,
        trigger: execution.trigger,
        recipients: recipients.map((r) => r.email),
        emailOutboxIds: outboxIds,
        ...(lateMs > 0 ? { lateMinutes: Math.round(lateMs / 60_000) } : {}),
      },
    },
  ]);
  return { result: { status: "sent", recipients: recipients.length } };
}
