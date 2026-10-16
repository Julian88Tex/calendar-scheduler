// ARCHITECTURE section 5.4.9: single-use links, one-off meetings (backed by an adhoc event type) and their spots,
// availability shares (OO-11, OO-12).
import { relations } from "drizzle-orm";
import { type AnyPgColumn, boolean, date, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { LocationConfig } from "../types.ts";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_columns.ts";
import { users } from "./auth.ts";
import { availabilitySchedules } from "./availability.ts";
import { eventTypes } from "./event-types.ts";
import { calendarLinkedEvents } from "./calendars.ts";
import { scheduledEvents } from "./bookings.ts";
import { contacts } from "./contacts.ts";

export const singleUseLinkStatus = pgEnum("single_use_link_status", ["active", "booked", "expired", "deleted"]);
export const oneOffStatus = pgEnum("one_off_status", ["pending", "booked", "expired", "deleted"]);
export const oneOffDateSetting = pgEnum("one_off_date_setting", ["spots", "date_range", "days_in_future"]);

export type DateRangeOverride =
  | { type: "rolling"; days: number; mode: "calendar_days" | "weekdays" | "available_days" }
  | { type: "fixed"; startDate: string; endDate: string }
  | { type: "unlimited" };

export const singleUseLinks = pgTable(
  "single_use_links",
  {
    id: pk(),
    code: text("code").notNull(), // 'xxxx-xxxx'
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id"),
    nameOverride: text("name_override"), // <= 55
    durationOverride: integer("duration_override"),
    durationOptionsOverride: integer("duration_options_override").array(),
    locationsOverride: jsonb("locations_override").$type<LocationConfig[] | null>(),
    // custom availability (availability_schedules.single_use_link_id)
    scheduleId: uuid("schedule_id"),
    dateRangeOverride: jsonb("date_range_override").$type<DateRangeOverride | null>(),
    hideLocation: boolean("hide_location").notNull().default(false),
    contactId: uuid("contact_id").references((): AnyPgColumn => contacts.id, { onDelete: "set null" }),
    prefillName: text("prefill_name"),
    prefillEmail: text("prefill_email"),
    maxEventCount: integer("max_event_count").notNull().default(1),
    bookedCount: integer("booked_count").notNull().default(0),
    status: singleUseLinkStatus("status").notNull().default("active"),
    source: text("source").notNull().default("ui"), // 'ui' | 'api_scheduling_link' | 'api_share'
    lastBookedScheduledEventId: uuid("last_booked_scheduled_event_id"),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("single_use_code_uq").on(t.code),
    index("single_use_owner_idx").on(t.ownerUserId, t.createdAt),
    index("single_use_event_type_idx").on(t.eventTypeId),
    index("single_use_contact_idx").on(t.contactId),
  ],
);

export const oneOffMeetings = pgTable(
  "one_off_meetings",
  {
    id: pk(),
    code: text("code").notNull(),
    // the adhoc event type holding name, duration, location, hosts, questions
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    timezone: text("timezone").notNull(),
    dateSetting: oneOffDateSetting("date_setting").notNull().default("spots"),
    dateRangeStart: date("date_range_start", { mode: "string" }),
    dateRangeEnd: date("date_range_end", { mode: "string" }),
    daysInFuture: integer("days_in_future"),
    onlyWeekdays: boolean("only_weekdays").notNull().default(false),
    reserveTimes: boolean("reserve_times").notNull().default(false),
    status: oneOffStatus("status").notNull().default("pending"),
    bookedScheduledEventId: uuid("booked_scheduled_event_id"),
    bookedAt: ts("booked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("one_off_code_uq").on(t.code),
    index("one_off_owner_status_idx").on(t.ownerUserId, t.status),
    index("one_off_event_type_idx").on(t.eventTypeId),
  ],
);

export const oneOffMeetingSpots = pgTable(
  "one_off_meeting_spots",
  {
    id: pk(),
    oneOffMeetingId: uuid("one_off_meeting_id")
      .notNull()
      .references((): AnyPgColumn => oneOffMeetings.id, { onDelete: "cascade" }),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    // external events knowingly overlapped at creation (OO-09)
    overlappedExternalIds: text("overlapped_external_ids").array().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("one_off_spots_idx").on(t.oneOffMeetingId, t.startAt)],
);

/** OO-11, OO-12 */
export const availabilityShares = pgTable(
  "availability_shares",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    eventTypeId: uuid("event_type_id").references((): AnyPgColumn => eventTypes.id, { onDelete: "set null" }),
    singleUseLinkId: uuid("single_use_link_id").references((): AnyPgColumn => singleUseLinks.id, { onDelete: "set null" }),
    recipientEmail: text("recipient_email").notNull(),
    recipientEmailNormalized: text("recipient_email_normalized").notNull(),
    recipientName: text("recipient_name"),
    contactId: uuid("contact_id"),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    reminderDays: integer("reminder_days"), // 1 | 3 | 7
    sentAt: ts("sent_at").notNull(),
    emailOutboxId: uuid("email_outbox_id"),
    bookedInviteeId: uuid("booked_invitee_id"),
    bookedAt: ts("booked_at"),
    followUpSentAt: ts("follow_up_sent_at"),
    followUpDismissedAt: ts("follow_up_dismissed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("shares_user_recipient_idx").on(t.userId, t.recipientEmailNormalized),
    index("shares_event_type_idx").on(t.eventTypeId),
    index("shares_single_use_idx").on(t.singleUseLinkId),
  ],
);

export const singleUseLinksRelations = relations(singleUseLinks, ({ one, many }) => ({
  eventType: one(eventTypes, {
    fields: [singleUseLinks.eventTypeId],
    references: [eventTypes.id],
    relationName: "single_use_links.event_type_id",
  }),
  owner: one(users, {
    fields: [singleUseLinks.ownerUserId],
    references: [users.id],
    relationName: "single_use_links.owner_user_id",
  }),
  contact: one(contacts, {
    fields: [singleUseLinks.contactId],
    references: [contacts.id],
    relationName: "single_use_links.contact_id",
  }),
  customSchedules: many(availabilitySchedules, { relationName: "availability_schedules.single_use_link_id" }),
  scheduledEvents: many(scheduledEvents, { relationName: "scheduled_events.single_use_link_id" }),
  availabilityShares: many(availabilityShares, { relationName: "availability_shares.single_use_link_id" }),
}));

export const oneOffMeetingsRelations = relations(oneOffMeetings, ({ one, many }) => ({
  eventType: one(eventTypes, {
    fields: [oneOffMeetings.eventTypeId],
    references: [eventTypes.id],
    relationName: "one_off_meetings.event_type_id",
  }),
  owner: one(users, {
    fields: [oneOffMeetings.ownerUserId],
    references: [users.id],
    relationName: "one_off_meetings.owner_user_id",
  }),
  spots: many(oneOffMeetingSpots, { relationName: "one_off_meeting_spots.one_off_meeting_id" }),
  scheduledEvents: many(scheduledEvents, { relationName: "scheduled_events.one_off_meeting_id" }),
  linkedCalendarEvents: many(calendarLinkedEvents, { relationName: "calendar_linked_events.one_off_meeting_id" }),
}));

export const oneOffMeetingSpotsRelations = relations(oneOffMeetingSpots, ({ one, many }) => ({
  oneOffMeeting: one(oneOffMeetings, {
    fields: [oneOffMeetingSpots.oneOffMeetingId],
    references: [oneOffMeetings.id],
    relationName: "one_off_meeting_spots.one_off_meeting_id",
  }),
  linkedCalendarEvents: many(calendarLinkedEvents, { relationName: "calendar_linked_events.one_off_spot_id" }),
}));

export const availabilitySharesRelations = relations(availabilityShares, ({ one }) => ({
  user: one(users, {
    fields: [availabilityShares.userId],
    references: [users.id],
    relationName: "availability_shares.user_id",
  }),
  eventType: one(eventTypes, {
    fields: [availabilityShares.eventTypeId],
    references: [eventTypes.id],
    relationName: "availability_shares.event_type_id",
  }),
  singleUseLink: one(singleUseLinks, {
    fields: [availabilityShares.singleUseLinkId],
    references: [singleUseLinks.id],
    relationName: "availability_shares.single_use_link_id",
  }),
}));
