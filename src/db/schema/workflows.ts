// ARCHITECTURE section 5.4.11: workflows (automations), steps, event type links, executions, SMS opt-outs.
// Basic notifications (NT-09): one workflows row per timing (email reminders allow up to 3 timings per event type).
import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_columns.ts";
import { users } from "./auth.ts";
import { organizations, teams } from "./organizations.ts";
import { eventTypes } from "./event-types.ts";
import { invitees, scheduledEvents } from "./bookings.ts";

export const workflowTrigger = pgEnum("workflow_trigger", [
  "booked",
  "before_start",
  "starts",
  "rescheduled",
  "ends",
  "canceled",
  "no_show",
]);
export const workflowAction = pgEnum("workflow_action", [
  "email_invitees",
  "email_host",
  "email_other",
  "sms_invitees",
  "sms_host",
  "sms_other",
]);
export const workflowScope = pgEnum("workflow_scope", ["user", "team"]);
export const basicNotificationKind = pgEnum("basic_notification_kind", [
  "email_reminder",
  "text_reminder",
  "email_follow_up",
]);
export const workflowExecutionStatus = pgEnum("workflow_execution_status", [
  "scheduled",
  "sent",
  "skipped",
  "failed",
  "canceled",
]);

export type WorkflowStepSnapshot = {
  workflowName: string;
  trigger: string;
  offsetMinutes: number;
  action: string;
  recipients: string[];
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  includeCancelRescheduleLinks: boolean;
  includeGuests: boolean;
  replyTo: string | null;
  isBasic: boolean;
};

/** NT-11: offsets up to 365 days. */
export const WORKFLOW_MAX_OFFSET_MINUTES = 525600;

export const workflows = pgTable(
  "workflows",
  {
    id: pk(),
    organizationId: uuid("organization_id")
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references((): AnyPgColumn => teams.id, { onDelete: "cascade" }),
    scope: workflowScope("scope").notNull().default("user"),
    name: text("name").notNull(),
    trigger: workflowTrigger("trigger").notNull(),
    offsetMinutes: integer("offset_minutes").notNull().default(0), // 0..525600 (365 days, NT-11)
    active: boolean("active").notNull().default(true),
    isBasic: boolean("is_basic").notNull().default(false),
    basicKind: basicNotificationKind("basic_kind"),
    basicEventTypeId: uuid("basic_event_type_id").references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    templateKey: text("template_key"),
    managedTemplateId: uuid("managed_template_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("workflows_owner_idx").on(t.ownerUserId),
    index("workflows_team_idx").on(t.teamId),
    uniqueIndex("workflows_basic_uq")
      .on(t.basicEventTypeId, t.basicKind, t.offsetMinutes)
      .where(sql`is_basic and deleted_at is null`),
    index("workflows_org_idx").on(t.organizationId),
    index("workflows_basic_event_type_idx").on(t.basicEventTypeId),
    check("workflows_offset_ck", sql`offset_minutes between 0 and 525600`),
  ],
);

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: pk(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references((): AnyPgColumn => workflows.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    action: workflowAction("action").notNull(),
    recipients: text("recipients").array().notNull().default([]), // emails or E.164 for *_other
    subject: text("subject"),
    bodyHtml: text("body_html"),
    bodyText: text("body_text"), // SMS
    includeCancelRescheduleLinks: boolean("include_cancel_reschedule_links").notNull().default(true),
    includeGuests: boolean("include_guests").notNull().default(false),
    replyTo: text("reply_to"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("workflow_steps_idx").on(t.workflowId, t.position)],
);

export const workflowEventTypes = pgTable(
  "workflow_event_types",
  {
    workflowId: uuid("workflow_id")
      .notNull()
      .references((): AnyPgColumn => workflows.id, { onDelete: "cascade" }),
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workflowId, t.eventTypeId] }),
    index("workflow_event_types_et_idx").on(t.eventTypeId),
  ],
);

export const workflowExecutions = pgTable(
  "workflow_executions",
  {
    id: pk(),
    workflowId: uuid("workflow_id").references((): AnyPgColumn => workflows.id, { onDelete: "set null" }),
    stepId: uuid("step_id").references((): AnyPgColumn => workflowSteps.id, { onDelete: "set null" }),
    scheduledEventId: uuid("scheduled_event_id")
      .notNull()
      .references((): AnyPgColumn => scheduledEvents.id, { onDelete: "cascade" }),
    // null for slot-level host/other actions
    inviteeId: uuid("invitee_id").references((): AnyPgColumn => invitees.id, { onDelete: "cascade" }),
    trigger: workflowTrigger("trigger").notNull(),
    runAt: ts("run_at").notNull(),
    status: workflowExecutionStatus("status").notNull().default("scheduled"),
    snapshot: jsonb("snapshot").$type<WorkflowStepSnapshot>().notNull(),
    jobId: uuid("job_id"),
    skipReason: text("skip_reason"),
    error: text("error"),
    sentAt: ts("sent_at"),
    emailOutboxId: uuid("email_outbox_id"),
    smsMessageId: uuid("sms_message_id"),
    // '{stepId}:{inviteeId | "slot:" + scheduledEventId}:{trigger}' (no run time, so backfill and re-enabling never
    // duplicate)
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("wf_exec_idem_uq").on(t.idempotencyKey),
    index("wf_exec_event_idx").on(t.scheduledEventId, t.status),
    index("wf_exec_workflow_idx").on(t.workflowId, t.status),
    index("wf_exec_invitee_idx").on(t.inviteeId, t.status),
    index("wf_exec_due_idx").on(t.status, t.runAt),
    index("wf_exec_step_idx").on(t.stepId),
  ],
);

export const smsOptOuts = pgTable("sms_opt_outs", {
  phone: text("phone").primaryKey(),
  source: text("source").notNull(), // 'stop' | 'manual'
  createdAt: createdAt(),
});

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [workflows.organizationId],
    references: [organizations.id],
    relationName: "workflows.organization_id",
  }),
  owner: one(users, { fields: [workflows.ownerUserId], references: [users.id], relationName: "workflows.owner_user_id" }),
  team: one(teams, { fields: [workflows.teamId], references: [teams.id], relationName: "workflows.team_id" }),
  basicEventType: one(eventTypes, {
    fields: [workflows.basicEventTypeId],
    references: [eventTypes.id],
    relationName: "workflows.basic_event_type_id",
  }),
  steps: many(workflowSteps, { relationName: "workflow_steps.workflow_id" }),
  eventTypes: many(workflowEventTypes, { relationName: "workflow_event_types.workflow_id" }),
  executions: many(workflowExecutions, { relationName: "workflow_executions.workflow_id" }),
}));

export const workflowStepsRelations = relations(workflowSteps, ({ one, many }) => ({
  workflow: one(workflows, {
    fields: [workflowSteps.workflowId],
    references: [workflows.id],
    relationName: "workflow_steps.workflow_id",
  }),
  executions: many(workflowExecutions, { relationName: "workflow_executions.step_id" }),
}));

export const workflowEventTypesRelations = relations(workflowEventTypes, ({ one }) => ({
  workflow: one(workflows, {
    fields: [workflowEventTypes.workflowId],
    references: [workflows.id],
    relationName: "workflow_event_types.workflow_id",
  }),
  eventType: one(eventTypes, {
    fields: [workflowEventTypes.eventTypeId],
    references: [eventTypes.id],
    relationName: "workflow_event_types.event_type_id",
  }),
}));

export const workflowExecutionsRelations = relations(workflowExecutions, ({ one }) => ({
  workflow: one(workflows, {
    fields: [workflowExecutions.workflowId],
    references: [workflows.id],
    relationName: "workflow_executions.workflow_id",
  }),
  step: one(workflowSteps, {
    fields: [workflowExecutions.stepId],
    references: [workflowSteps.id],
    relationName: "workflow_executions.step_id",
  }),
  scheduledEvent: one(scheduledEvents, {
    fields: [workflowExecutions.scheduledEventId],
    references: [scheduledEvents.id],
    relationName: "workflow_executions.scheduled_event_id",
  }),
  invitee: one(invitees, {
    fields: [workflowExecutions.inviteeId],
    references: [invitees.id],
    relationName: "workflow_executions.invitee_id",
  }),
}));
