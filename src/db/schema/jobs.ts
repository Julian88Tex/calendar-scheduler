// ARCHITECTURE section 5.4.13: durable job queue and the domain event log.
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt } from "./_columns.ts";

export const jobStatus = pgEnum("job_status", ["pending", "running", "succeeded", "failed", "canceled", "dead"]);

export const jobs = pgTable(
  "jobs",
  {
    id: pk(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    // Always set by enqueueJob from now() (fake time aware); never rely on a DB default.
    runAt: ts("run_at").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    priority: smallint("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    lockedUntil: ts("locked_until"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    result: jsonb("result").$type<unknown>(),
    idempotencyKey: text("idempotency_key"),
    groupKey: text("group_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("jobs_due_idx").on(t.runAt, t.priority).where(sql`status = 'pending'`),
    uniqueIndex("jobs_idem_uq").on(t.idempotencyKey).where(sql`idempotency_key is not null`),
    index("jobs_group_idx").on(t.groupKey).where(sql`status = 'pending'`),
    index("jobs_type_status_idx").on(t.type, t.status),
    index("jobs_stuck_idx").on(t.lockedUntil).where(sql`status = 'running'`),
  ],
);

export type DomainEventActor = { type: "user" | "system" | "api" | "invitee"; userId?: string; name?: string };

/** Log of published events (webhook envelope source, debugging). */
export const domainEvents = pgTable(
  "domain_events",
  {
    id: pk(),
    type: text("type").notNull(),
    organizationId: uuid("organization_id"),
    actor: jsonb("actor").$type<DomainEventActor | null>(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    index("domain_events_type_idx").on(t.type, t.occurredAt),
    index("domain_events_org_idx").on(t.organizationId, t.occurredAt),
  ],
);
