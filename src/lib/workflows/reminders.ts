// Event type reminders (SPEC NT-09, ET-25, NT-11, NT-13, NT-15 backfill, NT-24; docs/SCOPE.md workflows lite): the
// service behind the event type editor's "Notifications and workflows" rows.
//
// Storage (ARCHITECTURE 5.4.11, section 14):
// - "Email reminders" (to invitees) are basic notifications: one `workflows` row per timing with is_basic = true,
//   basic_kind = 'email_reminder', basic_event_type_id = the event type, trigger before_start and offset_minutes, and
//   one email_invitees step. Up to 3 timings.
// - "Email reminders to host" are the Calendly "Email reminder to host" workflow, one row per timing assigned to this
//   event type through workflow_event_types (template_key 'event_type_host_reminder'), one email_host step. They
//   count toward the 50 workflows limit (NT-24).
// - Every timing row of a kind shares the on/off flag, subject, message and links option. Subject and message are
//   null while the host keeps the defaults (rendered in the recipient's language at send time, GEN-10).
//
// Semantics: switching a row on (or adding or changing a timing) enqueues workflows.backfill for meetings already
// booked; switching it off leaves scheduled reminders in place (they skip at send time while off, so switching back
// on before the time sends them, and never duplicates); removing a timing cancels its pending reminders
// (skip_reason 'unassigned') and adding it back revives them. Edits to the message apply to reminders scheduled
// after the change (snapshots, NT-15). Cross-tenant: the event type must be editable by the actor
// (assertEventTypesEditable inside the transaction).
import "server-only";
import { and, count, countDistinct, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb, type DB, type DbOrTx } from "@/db";
import { advisoryXactLock } from "@/db/helpers";
import { eventTypes, workflowEventTypes, workflowExecutions, workflowSteps, workflows } from "@/db/schema";
import { assertAccess, assertEventTypesEditable, eventTypeAccess, eventTypeAccessAtLeast, type ActorCtx } from "@/lib/authz";
import { AppError, notFoundError, validationError } from "@/lib/errors";
import { escapeHtml, richTextToPlain, sanitizeRichText } from "@/lib/html";
import { getT } from "@/lib/i18n";
import { listTemplateVariables, renderTemplate } from "@/lib/template";
import { now as clockNow } from "@/lib/time/now";
import { absoluteUrl } from "@/lib/url";
import { enqueueBackfill } from "./backfill";
import { getReminderDeliveryHealth } from "./health";
import { BODY_TEXT_MAX, REMINDER_MESSAGES, type SaveRemindersInput, type ToggleRemindersInput } from "./schemas";
import { cancelExecutions, type StepRow, type WorkflowRow } from "./store";
import { DEFAULT_REMINDER_OFFSET_MINUTES, sortOffsets, toOffsetMinutes } from "./timing";
import type { EventTypeRemindersView, ReminderDefaults, ReminderKind, ReminderRowView } from "./types";

export const HOST_REMINDER_TEMPLATE_KEY = "event_type_host_reminder";
export const BASIC_REMINDER_KIND = "email_reminder" as const;
/** NT-24: up to 50 workflows per user (basic notifications do not count). */
export const MAX_WORKFLOWS_PER_USER = 50;

/** Workflow names (shown in the meeting activity log). */
export const REMINDER_WORKFLOW_NAMES: Record<ReminderKind, string> = {
  invitee: "Email reminder to invitees",
  host: "Email reminder to host",
};

type ReminderRow = { workflow: WorkflowRow; step: StepRow | null };

type EventTypeInfo = {
  id: string;
  name: string;
  organizationId: string;
  type: "standard" | "adhoc";
  locale: string;
  deletedAt: Date | null;
  includeCancelRescheduleLinks: boolean;
};

async function loadEventType(db: DbOrTx, id: string): Promise<EventTypeInfo | null> {
  const [row] = await db
    .select({
      id: eventTypes.id,
      name: eventTypes.name,
      organizationId: eventTypes.organizationId,
      type: eventTypes.type,
      locale: eventTypes.locale,
      deletedAt: eventTypes.deletedAt,
      includeCancelRescheduleLinks: eventTypes.includeCancelRescheduleLinks,
    })
    .from(eventTypes)
    .where(eq(eventTypes.id, id))
    .limit(1);
  return row ?? null;
}

/** The timing rows of one reminder kind for an event type (live rows unless `deleted` is true). */
async function reminderRows(db: DbOrTx, eventTypeId: string, kind: ReminderKind, opts: { deleted?: boolean } = {}): Promise<ReminderRow[]> {
  const live = opts.deleted ? isNotNull(workflows.deletedAt) : isNull(workflows.deletedAt);
  const rows =
    kind === "invitee"
      ? await db
          .select({ workflow: workflows, step: workflowSteps })
          .from(workflows)
          .leftJoin(workflowSteps, eq(workflowSteps.workflowId, workflows.id))
          .where(and(eq(workflows.isBasic, true), eq(workflows.basicEventTypeId, eventTypeId), eq(workflows.basicKind, BASIC_REMINDER_KIND), live))
          .orderBy(desc(workflows.offsetMinutes), desc(workflows.updatedAt))
      : await db
          .select({ workflow: workflows, step: workflowSteps })
          .from(workflows)
          .innerJoin(workflowEventTypes, eq(workflowEventTypes.workflowId, workflows.id))
          .leftJoin(workflowSteps, eq(workflowSteps.workflowId, workflows.id))
          .where(
            and(
              eq(workflows.isBasic, false),
              eq(workflows.templateKey, HOST_REMINDER_TEMPLATE_KEY),
              eq(workflowEventTypes.eventTypeId, eventTypeId),
              live,
            ),
          )
          .orderBy(desc(workflows.offsetMinutes), desc(workflows.updatedAt));
  // One step per reminder workflow (the lowest position wins if more exist).
  const out = new Map<string, ReminderRow>();
  for (const r of rows) {
    const prev = out.get(r.workflow.id);
    if (!prev || (r.step && (!prev.step || r.step.position < prev.step.position))) out.set(r.workflow.id, { workflow: r.workflow, step: r.step });
  }
  return [...out.values()];
}

/** The default subject and message of each reminder kind, in the event type's language (NT-09, GEN-10). */
export function reminderDefaults(locale: string): Record<ReminderKind, ReminderDefaults> {
  const t = getT(locale, "common");
  const greeting = (name: string) => escapeHtml(renderTemplate(t("meetingEmail.greeting.named"), { name }));
  return {
    invitee: {
      subject: t("meetingEmail.subjects.reminder"),
      bodyHtml: `<p>${greeting("{{invitee_first_name}}")}</p><p>${escapeHtml(t("meetingEmail.intro.reminder"))}</p>`,
    },
    host: {
      subject: t("meetingEmail.subjects.hostReminder"),
      bodyHtml: `<p>${greeting("{{my_name}}")}</p><p>${escapeHtml(t("meetingEmail.intro.hostReminder"))}</p>`,
    },
  };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** null when the subject is the default (stored as "use the default"), the trimmed subject otherwise. */
function normalizeSubject(subject: string | null, defaults: ReminderDefaults): string | null {
  if (subject === null) return null;
  const s = subject.replace(/[\r\n]+/g, " ").trim();
  if (!s) throw validationError({ subject: [REMINDER_MESSAGES.subjectRequired] }, REMINDER_MESSAGES.subjectRequired);
  return squash(s) === squash(defaults.subject) ? null : s;
}

/** null when the message is the default, the sanitized HTML otherwise. */
function normalizeBody(bodyHtml: string | null, defaults: ReminderDefaults): string | null {
  if (bodyHtml === null) return null;
  const clean = sanitizeRichText(bodyHtml);
  const plain = richTextToPlain(clean);
  if (!plain.trim()) throw validationError({ bodyHtml: [REMINDER_MESSAGES.bodyRequired] }, REMINDER_MESSAGES.bodyRequired);
  if (plain.length > BODY_TEXT_MAX) throw validationError({ bodyHtml: [REMINDER_MESSAGES.bodyTooLong] }, REMINDER_MESSAGES.bodyTooLong);
  return squash(plain) === squash(richTextToPlain(defaults.bodyHtml)) ? null : clean;
}

async function scheduledMeetingCounts(db: DbOrTx, rows: Record<ReminderKind, ReminderRow[]>, at: Date): Promise<Record<ReminderKind, number>> {
  const out: Record<ReminderKind, number> = { invitee: 0, host: 0 };
  for (const kind of ["invitee", "host"] as const) {
    const ids = rows[kind].map((r) => r.workflow.id);
    if (!ids.length) continue;
    const [row] = await db
      .select({ n: countDistinct(workflowExecutions.scheduledEventId) })
      .from(workflowExecutions)
      .where(and(inArray(workflowExecutions.workflowId, ids), eq(workflowExecutions.status, "scheduled"), gt(workflowExecutions.runAt, at)));
    out[kind] = Number(row?.n ?? 0);
  }
  return out;
}

function rowView(kind: ReminderKind, rows: ReminderRow[], scheduledMeetings: number, defaultIncludeLinks: boolean): ReminderRowView {
  const first = rows.find((r) => r.step) ?? rows[0];
  return {
    kind,
    enabled: rows.some((r) => r.workflow.active),
    configured: rows.length > 0,
    offsets: sortOffsets(rows.map((r) => r.workflow.offsetMinutes)),
    subject: first?.step?.subject ?? null,
    bodyHtml: first?.step?.bodyHtml ?? null,
    includeCancelRescheduleLinks: kind === "invitee" ? (first?.step?.includeCancelRescheduleLinks ?? defaultIncludeLinks) : false,
    scheduledMeetings,
  };
}

async function buildView(db: DbOrTx, actor: ActorCtx, et: EventTypeInfo, canEdit: boolean, readOnlyReason: string | null): Promise<EventTypeRemindersView> {
  const at = clockNow();
  const rows = { invitee: await reminderRows(db, et.id, "invitee"), host: await reminderRows(db, et.id, "host") };
  const counts = await scheduledMeetingCounts(db, rows, at);
  const health = await getReminderDeliveryHealth({ organizationId: actor.orgId, db, at });
  return {
    eventTypeId: et.id,
    eventTypeName: et.name,
    canEdit,
    readOnlyReason,
    invitee: rowView("invitee", rows.invitee, counts.invitee, et.includeCancelRescheduleLinks),
    host: rowView("host", rows.host, counts.host, false),
    defaults: reminderDefaults(et.locale),
    defaultIncludeLinks: et.includeCancelRescheduleLinks,
    delivery: {
      dispatcher: health.dispatcher,
      lastCronAt: health.lastCronAt,
      cronStale: health.cronStale,
      overdueCount: health.overdueCount,
      warning: health.warning,
      cronUrl: absoluteUrl("/api/cron"),
      nowMs: at.getTime(),
    },
    variables: listTemplateVariables()
      .filter((v) => !v.smsOnly && v.key !== "reconfirm_url")
      .map((v) => ({ key: v.key, label: v.label })),
  };
}

/** The reminders section view of an event type (view access required; editing needs edit access). */
export async function getEventTypeReminders(actor: ActorCtx, eventTypeId: string, db?: DbOrTx): Promise<EventTypeRemindersView> {
  const d = db ?? (await getDb());
  const access = await eventTypeAccess(actor, eventTypeId, d);
  assertAccess(access, "You don't have access to this event type.");
  const et = await loadEventType(d, eventTypeId);
  if (!et || et.deletedAt) throw notFoundError("This event type no longer exists.");
  const editable = eventTypeAccessAtLeast(access, "edit");
  const readOnlyReason =
    et.type !== "standard" ? REMINDER_MESSAGES.notAvailable : editable ? null : "Only people who can edit this event type can change its reminders.";
  return buildView(d, actor, et, editable && et.type === "standard", readOnlyReason);
}

async function lockedEditableEventType(tx: DbOrTx, actor: ActorCtx, eventTypeId: string): Promise<EventTypeInfo> {
  await advisoryXactLock(tx, `workflows:reminders:${eventTypeId}`);
  await assertEventTypesEditable(tx, actor, [eventTypeId]);
  const et = await loadEventType(tx, eventTypeId);
  if (!et || et.deletedAt) throw notFoundError("This event type no longer exists.");
  if (et.type !== "standard") throw new AppError("validation", REMINDER_MESSAGES.notAvailable);
  return et;
}

async function assertWorkflowLimit(tx: DbOrTx, actor: ActorCtx, adding: number): Promise<void> {
  if (adding <= 0) return;
  const [row] = await tx
    .select({ n: count() })
    .from(workflows)
    .where(and(eq(workflows.ownerUserId, actor.user.id), eq(workflows.isBasic, false), isNull(workflows.deletedAt)));
  if (Number(row?.n ?? 0) + adding > MAX_WORKFLOWS_PER_USER) throw new AppError("validation", REMINDER_MESSAGES.limit);
}

type RowConfig = { subject: string | null; bodyHtml: string | null; includeCancelRescheduleLinks: boolean };

async function writeStep(tx: DbOrTx, workflowId: string, kind: ReminderKind, config: RowConfig, at: Date, existing: StepRow | null): Promise<void> {
  const values = {
    action: kind === "invitee" ? ("email_invitees" as const) : ("email_host" as const),
    recipients: [],
    subject: config.subject,
    bodyHtml: config.bodyHtml,
    bodyText: null,
    includeCancelRescheduleLinks: kind === "invitee" ? config.includeCancelRescheduleLinks : false,
    includeGuests: false,
    replyTo: null,
    updatedAt: at,
  };
  if (existing) await tx.update(workflowSteps).set(values).where(eq(workflowSteps.id, existing.id));
  else await tx.insert(workflowSteps).values({ workflowId, position: 0, ...values, createdAt: at });
}

/** Inserts (or revives a deleted row of) one timing; returns the workflow id. */
async function createTiming(
  tx: DbOrTx,
  actor: ActorCtx,
  et: EventTypeInfo,
  kind: ReminderKind,
  offset: number,
  enabled: boolean,
  config: RowConfig,
  deleted: ReminderRow[],
  at: Date,
): Promise<string> {
  const revive = deleted.find((r) => r.workflow.offsetMinutes === offset);
  if (revive) {
    await tx
      .update(workflows)
      .set({ deletedAt: null, active: enabled, name: REMINDER_WORKFLOW_NAMES[kind], updatedAt: at })
      .where(eq(workflows.id, revive.workflow.id));
    await writeStep(tx, revive.workflow.id, kind, config, at, revive.step);
    deleted.splice(deleted.indexOf(revive), 1);
    return revive.workflow.id;
  }
  const [created] = await tx
    .insert(workflows)
    .values({
      organizationId: et.organizationId,
      ownerUserId: actor.user.id,
      scope: "user",
      name: REMINDER_WORKFLOW_NAMES[kind],
      trigger: "before_start",
      offsetMinutes: offset,
      active: enabled,
      isBasic: kind === "invitee",
      basicKind: kind === "invitee" ? BASIC_REMINDER_KIND : null,
      basicEventTypeId: kind === "invitee" ? et.id : null,
      templateKey: kind === "host" ? HOST_REMINDER_TEMPLATE_KEY : "basic_email_reminder",
      createdAt: at,
      updatedAt: at,
    })
    .returning({ id: workflows.id });
  if (!created) throw new Error("workflows insert returned no row");
  await writeStep(tx, created.id, kind, config, at, null);
  if (kind === "host") await tx.insert(workflowEventTypes).values({ workflowId: created.id, eventTypeId: et.id, createdAt: at });
  return created.id;
}

/** Soft deletes timing rows and cancels their pending reminders (skip_reason 'unassigned'). */
async function removeTimings(tx: DbOrTx, rows: ReminderRow[], at: Date): Promise<void> {
  if (!rows.length) return;
  const ids = rows.map((r) => r.workflow.id);
  await tx.update(workflows).set({ deletedAt: at, active: false, updatedAt: at }).where(inArray(workflows.id, ids));
  await cancelExecutions(tx, inArray(workflowExecutions.workflowId, ids), "unassigned");
}

export type SaveRemindersResult = { view: EventTypeRemindersView; backfillJobs: number };

/** Saves one reminder row from the edit dialog (see the file header). */
export async function saveEventTypeReminders(actor: ActorCtx, input: SaveRemindersInput, db?: DB): Promise<SaveRemindersResult> {
  const d = db ?? (await getDb());
  return d.transaction(async (tx) => {
    const et = await lockedEditableEventType(tx, actor, input.eventTypeId);
    const defaults = reminderDefaults(et.locale)[input.kind];
    const config: RowConfig = {
      subject: normalizeSubject(input.subject, defaults),
      bodyHtml: normalizeBody(input.bodyHtml, defaults),
      includeCancelRescheduleLinks: input.includeCancelRescheduleLinks,
    };
    const offsets = sortOffsets(input.timings.map((t) => toOffsetMinutes(t.amount, t.unit)));
    const live = await reminderRows(tx, et.id, input.kind);
    const deleted = await reminderRows(tx, et.id, input.kind, { deleted: true });
    if (input.kind === "host") {
      const adding = offsets.filter((o) => !live.some((r) => r.workflow.offsetMinutes === o)).length;
      const removing = live.filter((r) => !offsets.includes(r.workflow.offsetMinutes)).length;
      await assertWorkflowLimit(tx, actor, adding - removing);
    }
    const at = clockNow();
    const backfill: string[] = [];
    // Remove first: a removed timing frees its slot in the basic notifications unique index.
    await removeTimings(
      tx,
      live.filter((r) => !offsets.includes(r.workflow.offsetMinutes)),
      at,
    );
    for (const offset of offsets) {
      const existing = live.find((r) => r.workflow.offsetMinutes === offset);
      if (existing) {
        await tx
          .update(workflows)
          .set({ active: input.enabled, name: REMINDER_WORKFLOW_NAMES[input.kind], updatedAt: at })
          .where(eq(workflows.id, existing.workflow.id));
        await writeStep(tx, existing.workflow.id, input.kind, config, at, existing.step);
        if (input.enabled && !existing.workflow.active) backfill.push(existing.workflow.id);
      } else {
        const id = await createTiming(tx, actor, et, input.kind, offset, input.enabled, config, deleted, at);
        if (input.enabled) backfill.push(id);
      }
    }
    let backfillJobs = 0;
    for (const workflowId of backfill) {
      if (await enqueueBackfill(tx, { workflowId, eventTypeIds: [et.id], version: at })) backfillJobs++;
    }
    return { view: await buildView(tx, actor, et, true, null), backfillJobs };
  });
}

/** The On/Off menu toggle: switching on a row that was never set up creates it with the defaults (24 hours before). */
export async function setEventTypeRemindersEnabled(actor: ActorCtx, input: ToggleRemindersInput, db?: DB): Promise<SaveRemindersResult> {
  const d = db ?? (await getDb());
  return d.transaction(async (tx) => {
    const et = await lockedEditableEventType(tx, actor, input.eventTypeId);
    const live = await reminderRows(tx, et.id, input.kind);
    const at = clockNow();
    const backfill: string[] = [];
    if (!live.length) {
      if (input.enabled) {
        if (input.kind === "host") await assertWorkflowLimit(tx, actor, 1);
        const deleted = await reminderRows(tx, et.id, input.kind, { deleted: true });
        const config: RowConfig = { subject: null, bodyHtml: null, includeCancelRescheduleLinks: et.includeCancelRescheduleLinks };
        backfill.push(await createTiming(tx, actor, et, input.kind, DEFAULT_REMINDER_OFFSET_MINUTES, true, config, deleted, at));
      }
    } else {
      for (const r of live) {
        if (r.workflow.active === input.enabled) continue;
        await tx.update(workflows).set({ active: input.enabled, updatedAt: at }).where(eq(workflows.id, r.workflow.id));
        if (input.enabled) backfill.push(r.workflow.id);
      }
    }
    let backfillJobs = 0;
    for (const workflowId of backfill) {
      if (await enqueueBackfill(tx, { workflowId, eventTypeIds: [et.id], version: at })) backfillJobs++;
    }
    return { view: await buildView(tx, actor, et, true, null), backfillJobs };
  });
}
