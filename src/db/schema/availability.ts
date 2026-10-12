// ARCHITECTURE section 5.4.4: availability schedules, date overrides and holiday overrides.
import { relations, sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, date, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { MinuteRange, WeeklyHours } from "../types.ts";
import { createdAt, deletedAt, pk, updatedAt } from "./_columns.ts";
import { users } from "./auth.ts";
import { eventTypeHosts, eventTypes } from "./event-types.ts";
import { singleUseLinks } from "./links.ts";

export const availabilitySchedules = pgTable(
  "availability_schedules",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    weeklyHours: jsonb("weekly_hours").$type<WeeklyHours>().notNull(),
    // Set for event-type custom schedules (and per-host custom hours).
    eventTypeId: uuid("event_type_id").references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    // Single-use custom availability.
    singleUseLinkId: uuid("single_use_link_id").references((): AnyPgColumn => singleUseLinks.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("schedules_user_idx").on(t.userId),
    index("schedules_event_type_idx").on(t.eventTypeId),
    index("schedules_single_use_idx").on(t.singleUseLinkId),
    uniqueIndex("schedules_one_default_uq")
      .on(t.userId)
      .where(sql`is_default and event_type_id is null and single_use_link_id is null and deleted_at is null`),
  ],
);

export const availabilityDateOverrides = pgTable(
  "availability_date_overrides",
  {
    id: pk(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references((): AnyPgColumn => availabilitySchedules.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    intervals: jsonb("intervals").$type<MinuteRange[]>().notNull().default([]), // empty = unavailable
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("overrides_schedule_date_uq").on(t.scheduleId, t.date)],
);

/** Absent row = holiday observed (unavailable). */
export const userHolidayOverrides = pgTable(
  "user_holiday_overrides",
  {
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    // '{country}:{stable rule id}', year independent, e.g. 'US:thanksgiving'; observed/substitute days append
    // ':substitute' (AV-13)
    holidayKey: text("holiday_key").notNull(),
    observed: boolean("observed").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.holidayKey] })],
);

export const availabilitySchedulesRelations = relations(availabilitySchedules, ({ one, many }) => ({
  user: one(users, {
    fields: [availabilitySchedules.userId],
    references: [users.id],
    relationName: "availability_schedules.user_id",
  }),
  eventType: one(eventTypes, {
    fields: [availabilitySchedules.eventTypeId],
    references: [eventTypes.id],
    relationName: "availability_schedules.event_type_id",
  }),
  singleUseLink: one(singleUseLinks, {
    fields: [availabilitySchedules.singleUseLinkId],
    references: [singleUseLinks.id],
    relationName: "availability_schedules.single_use_link_id",
  }),
  dateOverrides: many(availabilityDateOverrides, { relationName: "availability_date_overrides.schedule_id" }),
  eventTypesUsing: many(eventTypes, { relationName: "event_types.schedule_id" }),
  eventTypeHosts: many(eventTypeHosts, { relationName: "event_type_hosts.schedule_id" }),
}));

export const availabilityDateOverridesRelations = relations(availabilityDateOverrides, ({ one }) => ({
  schedule: one(availabilitySchedules, {
    fields: [availabilityDateOverrides.scheduleId],
    references: [availabilitySchedules.id],
    relationName: "availability_date_overrides.schedule_id",
  }),
}));

export const userHolidayOverridesRelations = relations(userHolidayOverrides, ({ one }) => ({
  user: one(users, {
    fields: [userHolidayOverrides.userId],
    references: [users.id],
    relationName: "user_holiday_overrides.user_id",
  }),
}));
