// ARCHITECTURE section 5.4.12: email outbox (every email, sent or stored) and SMS log.
import { index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt } from "./_columns.ts";

export const emailStatus = pgEnum("email_status", ["queued", "sending", "sent", "stored", "failed"]);
export const smsStatus = pgEnum("sms_status", ["queued", "sent", "stored", "failed", "skipped"]);

export type EmailAttachment = { filename: string; contentType: string; contentBase64: string };

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: pk(),
    organizationId: uuid("organization_id"),
    toAddresses: text("to_addresses").array().notNull(),
    ccAddresses: text("cc_addresses").array().notNull().default([]),
    bccAddresses: text("bcc_addresses").array().notNull().default([]),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    replyTo: text("reply_to"),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    attachments: jsonb("attachments").$type<EmailAttachment[]>().notNull().default([]),
    icsMethod: text("ics_method"), // 'REQUEST' | 'CANCEL'
    ics: text("ics"),
    template: text("template").notNull(),
    category: text("category").notNull(), // 'transactional' | 'workflow' | 'poll' | 'system' | 'auth'
    status: emailStatus("status").notNull().default("queued"),
    provider: text("provider"), // 'resend' | 'smtp' | 'outbox'
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull(),
    relatedUserId: uuid("related_user_id"),
    scheduledEventId: uuid("scheduled_event_id"),
    inviteeId: uuid("invitee_id"),
    pollId: uuid("poll_id"),
    workflowExecutionId: uuid("workflow_execution_id"),
    // html and text set to '' and attachments, ics cleared by system.cleanup after 30 days (GEN-16)
    bodyPurgedAt: ts("body_purged_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [
    uniqueIndex("email_outbox_idem_uq").on(t.idempotencyKey),
    index("email_outbox_status_idx").on(t.status, t.createdAt),
    index("email_outbox_event_idx").on(t.scheduledEventId),
    index("email_outbox_invitee_idx").on(t.inviteeId),
    index("email_outbox_user_idx").on(t.relatedUserId, t.createdAt),
  ],
);

export const smsMessages = pgTable(
  "sms_messages",
  {
    id: pk(),
    organizationId: uuid("organization_id"),
    toNumber: text("to_number").notNull(),
    fromNumber: text("from_number"),
    body: text("body").notNull(),
    status: smsStatus("status").notNull().default("queued"),
    provider: text("provider"), // 'twilio' | 'outbox'
    providerSid: text("provider_sid"),
    segments: integer("segments"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull(),
    scheduledEventId: uuid("scheduled_event_id"),
    inviteeId: uuid("invitee_id"),
    workflowExecutionId: uuid("workflow_execution_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [uniqueIndex("sms_idem_uq").on(t.idempotencyKey), index("sms_status_idx").on(t.status, t.createdAt)],
);

// No foreign keys in this file (rows outlive what they reference), so no relations().
