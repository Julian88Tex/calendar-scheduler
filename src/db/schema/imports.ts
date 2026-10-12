// ARCHITECTURE section 5.4.20 (BR-17 Calendly import, CAL-22). The personal access token is never stored in these
// tables: it travels encrypted in the settings.calendly_import job payload and the handler clears it when the run ends.
import { relations } from "drizzle-orm";
import { type AnyPgColumn, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt } from "./_columns.ts";
import { users } from "./auth.ts";

export const importSource = pgEnum("import_source", ["calendly"]);
export const importRunStatus = pgEnum("import_run_status", ["pending", "running", "completed", "failed"]);

export type ImportRunOptions = { eventTypes: boolean; schedules: boolean; profile: boolean; meetingsAsBusy: boolean };
export type ImportRunResult = {
  created: Record<string, number>;
  updated: Record<string, number>;
  skipped: { kind: string; name: string; reason: string }[];
};

export const importRuns = pgTable(
  "import_runs",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    source: importSource("source").notNull(),
    status: importRunStatus("status").notNull().default("pending"),
    options: jsonb("options").$type<ImportRunOptions>().notNull(),
    result: jsonb("result").$type<ImportRunResult | null>(),
    error: text("error"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("import_runs_user_idx").on(t.userId, t.createdAt)],
);

/** Idempotency: one local record per external record. */
export const importMappings = pgTable(
  "import_mappings",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    source: importSource("source").notNull(),
    entityType: text("entity_type").notNull(), // 'event_type' | 'schedule' | 'profile' | 'meeting'
    externalId: text("external_id").notNull(), // Calendly URI
    // local id (event_types, availability_schedules, users, external_events)
    entityId: uuid("entity_id").notNull(),
    // hash of the imported values, to detect local edits before overwriting
    importedHash: text("imported_hash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("import_mappings_uq").on(t.userId, t.source, t.entityType, t.externalId)],
);

export const importRunsRelations = relations(importRuns, ({ one }) => ({
  user: one(users, { fields: [importRuns.userId], references: [users.id], relationName: "import_runs.user_id" }),
}));

export const importMappingsRelations = relations(importMappings, ({ one }) => ({
  user: one(users, { fields: [importMappings.userId], references: [users.id], relationName: "import_mappings.user_id" }),
}));
