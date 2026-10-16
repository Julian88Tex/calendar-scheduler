// ARCHITECTURE section 5.4.19: audit log and GDPR style data deletion requests.
import { relations } from "drizzle-orm";
import { type AnyPgColumn, index, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, ts } from "./_columns.ts";
import { actorType } from "./_enums.ts";
import { organizations } from "./organizations.ts";

export const dataDeletionType = pgEnum("data_deletion_type", ["emails", "date_range"]);
export const dataDeletionStatus = pgEnum("data_deletion_status", ["pending", "running", "completed", "failed"]);

export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    organizationId: uuid("organization_id"),
    actorType: actorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorLabel: text("actor_label"),
    action: text("action").notNull(), // e.g. 'user.login', 'role.changed'
    namespace: text("namespace").notNull(), // 'auth' | 'org' | 'event_types' | ...
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    userAgent: text("user_agent"),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_org_time_idx").on(t.organizationId, t.occurredAt),
    index("audit_actor_idx").on(t.actorUserId, t.occurredAt),
    index("audit_ns_action_idx").on(t.namespace, t.action),
  ],
);

export const dataDeletionRequests = pgTable(
  "data_deletion_requests",
  {
    id: pk(),
    organizationId: uuid("organization_id")
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    type: dataDeletionType("type").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    status: dataDeletionStatus("status").notNull().default("pending"),
    requestedByUserId: uuid("requested_by_user_id"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
  },
  (t) => [index("data_deletion_org_idx").on(t.organizationId, t.createdAt)],
);

export const dataDeletionRequestsRelations = relations(dataDeletionRequests, ({ one }) => ({
  organization: one(organizations, {
    fields: [dataDeletionRequests.organizationId],
    references: [organizations.id],
    relationName: "data_deletion_requests.organization_id",
  }),
}));
