// ARCHITECTURE section 5.4.5: event types, host pools, hosts, questions, permissions, managed event assignments.
//
// Rules enforced by event type services (with cross-tenant checks, section 18.7): scope 'team' requires team_id;
// scope 'personal' or 'shared' requires owner_user_id; pooling_type non-null requires scope shared or team;
// kind 'group' requires pooling_type null and max_invitees >= 2; type 'adhoc' rows (one-off meetings and polls) are
// excluded from every event type list and landing page. Personal solo types have exactly one event_type_hosts row (the
// owner, pool null). Round robin: one pool with all hosts; multi_pool: required hosts (pool null) plus pools;
// collective: all hosts with pool null.
import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ConfirmationLink,
  FreeBusyException,
  LocationConfig,
  NotificationTemplates,
} from "../types.ts";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_columns.ts";
import { paymentProvider, permissionLevel } from "./_enums.ts";
import { users } from "./auth.ts";
import { organizations, teams } from "./organizations.ts";
import { availabilitySchedules } from "./availability.ts";
import { calendars } from "./calendars.ts";
import { bookingReservations, scheduledEventHosts, scheduledEvents } from "./bookings.ts";
import { availabilityShares, oneOffMeetings, singleUseLinks } from "./links.ts";
import { meetingPolls } from "./polls.ts";
import { workflowEventTypes, workflows } from "./workflows.ts";
import { eventTypeCoupons } from "./payments.ts";

export { paymentProvider, permissionLevel };

export const eventTypeScope = pgEnum("event_type_scope", ["personal", "shared", "team"]);
export const eventTypeType = pgEnum("event_type_type", ["standard", "adhoc"]);
export const bookingMethod = pgEnum("booking_method", ["instant", "poll"]);
export const eventKind = pgEnum("event_kind", ["solo", "group"]);
export const poolingType = pgEnum("pooling_type", ["collective", "round_robin", "multi_pool"]);
export const availabilitySetting = pgEnum("availability_setting", ["host", "shared"]);
export const dateRangeType = pgEnum("date_range_type", ["rolling", "fixed", "unlimited"]);
export const dateRangeMode = pgEnum("date_range_mode", ["calendar_days", "weekdays", "available_days"]);
export const slotAlignment = pgEnum("slot_alignment", ["interval_start", "hour"]);
export const timeZoneDisplay = pgEnum("time_zone_display", ["auto", "locked"]);
export const nameFormat = pgEnum("name_format", ["full", "first_last"]);
export const reschedulePreference = pgEnum("reschedule_preference", ["reassign", "same_hosts"]);
export const notificationType = pgEnum("notification_type", ["auto", "calendar_invitation", "email_confirmation"]);
export const afterBooking = pgEnum("after_booking", ["confirmation_page", "redirect"]);
export const questionType = pgEnum("question_type", [
  "string",
  "text",
  "single_select",
  "multi_select",
  "dropdown",
  "phone_number",
]);
export const rrDistribution = pgEnum("rr_distribution", ["availability", "equal"]);

export type ManagedSection =
  | "details"
  | "availability"
  | "limits"
  | "booking_form"
  | "notifications"
  | "confirmation"
  | "payment"
  | "permissions";

export const eventTypes = pgTable(
  "event_types",
  {
    id: pk(),
    organizationId: uuid("organization_id")
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }), // null for team types
    teamId: uuid("team_id").references((): AnyPgColumn => teams.id, { onDelete: "cascade" }),
    scope: eventTypeScope("scope").notNull().default("personal"),
    type: eventTypeType("type").notNull().default("standard"), // 'adhoc' = one-off meetings and polls
    bookingMethod: bookingMethod("booking_method").notNull().default("instant"),
    kind: eventKind("kind").notNull().default("solo"),
    poolingType: poolingType("pooling_type"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // '/d/{code}/...' for shared types (adhoc types reuse their link's code)
    shareCode: text("share_code"),
    color: text("color").notNull().default("#8247f5"),
    descriptionHtml: text("description_html"),
    descriptionPlain: text("description_plain"),
    internalNote: text("internal_note"),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    secret: boolean("secret").notNull().default(false),
    locale: text("locale").notNull().default("en"),
    durationMinutes: integer("duration_minutes").notNull().default(30), // check 1..720
    durationOptions: integer("duration_options").array(), // max 4, includes duration_minutes
    locations: jsonb("locations").$type<LocationConfig[]>().notNull().default([]),
    // null = each host's default schedule
    scheduleId: uuid("schedule_id").references((): AnyPgColumn => availabilitySchedules.id, { onDelete: "set null" }),
    availabilitySetting: availabilitySetting("availability_setting").notNull().default("host"), // 'shared' = everyone uses schedule_id
    dateRangeType: dateRangeType("date_range_type").notNull().default("rolling"),
    dateRangeDays: integer("date_range_days").notNull().default(60),
    dateRangeMode: dateRangeMode("date_range_mode").notNull().default("calendar_days"),
    dateRangeStart: date("date_range_start", { mode: "string" }),
    dateRangeEnd: date("date_range_end", { mode: "string" }),
    minimumNoticeMinutes: integer("minimum_notice_minutes").notNull().default(240),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    slotIncrementMinutes: integer("slot_increment_minutes").notNull().default(30),
    slotAlignment: slotAlignment("slot_alignment").notNull().default("interval_start"),
    limitPerDay: integer("limit_per_day"),
    limitPerWeek: integer("limit_per_week"),
    limitPerMonth: integer("limit_per_month"),
    timeZoneDisplay: timeZoneDisplay("time_zone_display").notNull().default("auto"),
    lockedTimeZone: text("locked_time_zone"),
    freeBusyExceptions: jsonb("free_busy_exceptions").$type<FreeBusyException[]>().notNull().default([]),
    nameFormat: nameFormat("name_format").notNull().default("full"),
    allowGuests: boolean("allow_guests").notNull().default(true),
    autofillInvitee: boolean("autofill_invitee").notNull().default(false),
    requireEmailVerification: boolean("require_email_verification").notNull().default(false),
    collectMarketingConsent: boolean("collect_marketing_consent").notNull().default(false),
    maxInvitees: integer("max_invitees").notNull().default(1), // group: 2..9999
    showRemainingSpots: boolean("show_remaining_spots").notNull().default(false),
    reschedulePreference: reschedulePreference("reschedule_preference").notNull().default("reassign"),
    notificationType: notificationType("notification_type").notNull().default("auto"),
    notificationTemplates: jsonb("notification_templates").$type<NotificationTemplates>().notNull().default({}),
    includeCancelRescheduleLinks: boolean("include_cancel_reschedule_links").notNull().default(true),
    includeAnswersInNotifications: boolean("include_answers_in_notifications").notNull().default(true),
    cancellationPolicy: text("cancellation_policy"),
    requireCancelReason: boolean("require_cancel_reason").notNull().default(false), // extension
    changeCutoffMinutes: integer("change_cutoff_minutes"), // extension, SCH-23
    afterBooking: afterBooking("after_booking").notNull().default("confirmation_page"),
    redirectUrl: text("redirect_url"),
    redirectPassDetails: boolean("redirect_pass_details").notNull().default(false),
    scheduleAnotherEnabled: boolean("schedule_another_enabled").notNull().default(true),
    scheduleAnotherLabel: text("schedule_another_label").notNull().default("Schedule another event"),
    confirmationLinks: jsonb("confirmation_links").$type<ConfirmationLink[]>().notNull().default([]),
    paymentEnabled: boolean("payment_enabled").notNull().default(false),
    paymentProvider: paymentProvider("payment_provider"),
    priceMinor: integer("price_minor"),
    currency: text("currency"), // 'AUD' | 'CAD' | 'EUR' | 'GBP' | 'USD'
    paymentTerms: text("payment_terms"),
    // extension CAL-20
    destinationCalendarId: uuid("destination_calendar_id").references((): AnyPgColumn => calendars.id, { onDelete: "set null" }),
    calendarEventTitleTemplate: text("calendar_event_title_template"), // null = kind default (CAL-11)
    // collective "Meeting organizer" (VID-13)
    organizerUserId: uuid("organizer_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    adminManaged: boolean("admin_managed").notNull().default(false),
    isManagedTemplate: boolean("is_managed_template").notNull().default(false),
    managedTemplateId: uuid("managed_template_id").references((): AnyPgColumn => eventTypes.id, {
      onDelete: "set null",
    }),
    managedLocks: jsonb("managed_locks").$type<Partial<Record<ManagedSection, boolean>>>(),
    managedSyncedAt: ts("managed_synced_at"),
    createdByUserId: uuid("created_by_user_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("event_types_user_slug_uq")
      .on(t.ownerUserId, t.slug)
      .where(sql`team_id is null and scope = 'personal' and type = 'standard' and deleted_at is null`),
    uniqueIndex("event_types_team_slug_uq")
      .on(t.teamId, t.slug)
      .where(sql`team_id is not null and deleted_at is null`),
    uniqueIndex("event_types_share_code_uq").on(t.shareCode).where(sql`share_code is not null`),
    index("event_types_owner_pos_idx").on(t.ownerUserId, t.position),
    index("event_types_team_pos_idx").on(t.teamId, t.position),
    index("event_types_org_idx").on(t.organizationId),
    index("event_types_schedule_idx").on(t.scheduleId),
    index("event_types_destination_calendar_idx").on(t.destinationCalendarId),
    index("event_types_organizer_idx").on(t.organizerUserId),
    index("event_types_managed_template_idx").on(t.managedTemplateId),
    check("event_types_duration_ck", sql`duration_minutes between 1 and 720`),
    check("event_types_seats_ck", sql`max_invitees between 1 and 9999`),
    // sched_group_slot_uq ignores duration, so group types have a single duration
    check("event_types_group_durations_ck", sql`kind <> 'group' or duration_options is null`),
  ],
);

export const eventTypeHostPools = pgTable(
  "event_type_host_pools",
  {
    id: pk(),
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Pool 1"),
    distribution: rrDistribution("distribution").notNull().default("availability"),
    position: integer("position").notNull().default(0),
    countsResetAt: ts("counts_reset_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("pools_event_type_idx").on(t.eventTypeId)],
);

export const eventTypeHosts = pgTable(
  "event_type_hosts",
  {
    id: pk(),
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    // null = required host (solo owner, collective co-host, multi_pool always-attending); else event_type_host_pools.id
    poolId: uuid("pool_id"),
    priority: smallint("priority").notNull().default(3), // 1 Lowest .. 5 Highest
    // null = host default schedule
    scheduleId: uuid("schedule_id").references((): AnyPgColumn => availabilitySchedules.id, { onDelete: "set null" }),
    locationOverride: jsonb("location_override").$type<LocationConfig | null>(), // TM-11 per-host location
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("event_type_hosts_uq").on(t.eventTypeId, t.userId),
    index("event_type_hosts_user_idx").on(t.userId),
    index("event_type_hosts_pool_idx").on(t.poolId),
    index("event_type_hosts_schedule_idx").on(t.scheduleId),
  ],
);

export const eventTypeQuestions = pgTable(
  "event_type_questions",
  {
    id: pk(),
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    type: questionType("type").notNull(),
    required: boolean("required").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    answerChoices: text("answer_choices").array().notNull().default([]),
    includeOther: boolean("include_other").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("questions_event_type_idx").on(t.eventTypeId, t.position)],
);

export const eventTypePermissions = pgTable(
  "event_type_permissions",
  {
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    level: permissionLevel("level").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.eventTypeId, t.userId] }), index("event_type_permissions_user_idx").on(t.userId)],
);

export const managedEventAssignments = pgTable(
  "managed_event_assignments",
  {
    id: pk(),
    templateEventTypeId: uuid("template_event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references((): AnyPgColumn => teams.id, { onDelete: "cascade" }),
    copyEventTypeId: uuid("copy_event_type_id").references((): AnyPgColumn => eventTypes.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("managed_assign_template_idx").on(t.templateEventTypeId),
    index("managed_assign_user_idx").on(t.userId),
    index("managed_assign_team_idx").on(t.teamId),
    index("managed_assign_copy_idx").on(t.copyEventTypeId),
  ],
);

export const eventTypesRelations = relations(eventTypes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [eventTypes.organizationId],
    references: [organizations.id],
    relationName: "event_types.organization_id",
  }),
  owner: one(users, {
    fields: [eventTypes.ownerUserId],
    references: [users.id],
    relationName: "event_types.owner_user_id",
  }),
  team: one(teams, { fields: [eventTypes.teamId], references: [teams.id], relationName: "event_types.team_id" }),
  schedule: one(availabilitySchedules, {
    fields: [eventTypes.scheduleId],
    references: [availabilitySchedules.id],
    relationName: "event_types.schedule_id",
  }),
  destinationCalendar: one(calendars, {
    fields: [eventTypes.destinationCalendarId],
    references: [calendars.id],
    relationName: "event_types.destination_calendar_id",
  }),
  organizer: one(users, {
    fields: [eventTypes.organizerUserId],
    references: [users.id],
    relationName: "event_types.organizer_user_id",
  }),
  managedTemplate: one(eventTypes, {
    fields: [eventTypes.managedTemplateId],
    references: [eventTypes.id],
    relationName: "event_types.managed_template_id",
  }),
  managedCopies: many(eventTypes, { relationName: "event_types.managed_template_id" }),
  customSchedules: many(availabilitySchedules, { relationName: "availability_schedules.event_type_id" }),
  pools: many(eventTypeHostPools, { relationName: "event_type_host_pools.event_type_id" }),
  hosts: many(eventTypeHosts, { relationName: "event_type_hosts.event_type_id" }),
  questions: many(eventTypeQuestions, { relationName: "event_type_questions.event_type_id" }),
  permissions: many(eventTypePermissions, { relationName: "event_type_permissions.event_type_id" }),
  managedAssignments: many(managedEventAssignments, {
    relationName: "managed_event_assignments.template_event_type_id",
  }),
  managedAssignmentCopies: many(managedEventAssignments, {
    relationName: "managed_event_assignments.copy_event_type_id",
  }),
  scheduledEvents: many(scheduledEvents, { relationName: "scheduled_events.event_type_id" }),
  reservations: many(bookingReservations, { relationName: "booking_reservations.event_type_id" }),
  singleUseLinks: many(singleUseLinks, { relationName: "single_use_links.event_type_id" }),
  oneOffMeetings: many(oneOffMeetings, { relationName: "one_off_meetings.event_type_id" }),
  availabilityShares: many(availabilityShares, { relationName: "availability_shares.event_type_id" }),
  poll: one(meetingPolls),
  basicWorkflows: many(workflows, { relationName: "workflows.basic_event_type_id" }),
  workflowLinks: many(workflowEventTypes, { relationName: "workflow_event_types.event_type_id" }),
  couponLinks: many(eventTypeCoupons, { relationName: "event_type_coupons.event_type_id" }),
}));

export const eventTypeHostPoolsRelations = relations(eventTypeHostPools, ({ one, many }) => ({
  eventType: one(eventTypes, {
    fields: [eventTypeHostPools.eventTypeId],
    references: [eventTypes.id],
    relationName: "event_type_host_pools.event_type_id",
  }),
  hosts: many(eventTypeHosts, { relationName: "event_type_hosts.pool_id" }),
  scheduledEventHosts: many(scheduledEventHosts, { relationName: "scheduled_event_hosts.pool_id" }),
}));

export const eventTypeHostsRelations = relations(eventTypeHosts, ({ one }) => ({
  eventType: one(eventTypes, {
    fields: [eventTypeHosts.eventTypeId],
    references: [eventTypes.id],
    relationName: "event_type_hosts.event_type_id",
  }),
  user: one(users, { fields: [eventTypeHosts.userId], references: [users.id], relationName: "event_type_hosts.user_id" }),
  // Logical reference (no FK constraint in ARCHITECTURE 5.4.5); null = required host.
  pool: one(eventTypeHostPools, {
    fields: [eventTypeHosts.poolId],
    references: [eventTypeHostPools.id],
    relationName: "event_type_hosts.pool_id",
  }),
  schedule: one(availabilitySchedules, {
    fields: [eventTypeHosts.scheduleId],
    references: [availabilitySchedules.id],
    relationName: "event_type_hosts.schedule_id",
  }),
}));

export const eventTypeQuestionsRelations = relations(eventTypeQuestions, ({ one }) => ({
  eventType: one(eventTypes, {
    fields: [eventTypeQuestions.eventTypeId],
    references: [eventTypes.id],
    relationName: "event_type_questions.event_type_id",
  }),
}));

export const eventTypePermissionsRelations = relations(eventTypePermissions, ({ one }) => ({
  eventType: one(eventTypes, {
    fields: [eventTypePermissions.eventTypeId],
    references: [eventTypes.id],
    relationName: "event_type_permissions.event_type_id",
  }),
  user: one(users, {
    fields: [eventTypePermissions.userId],
    references: [users.id],
    relationName: "event_type_permissions.user_id",
  }),
}));

export const managedEventAssignmentsRelations = relations(managedEventAssignments, ({ one }) => ({
  templateEventType: one(eventTypes, {
    fields: [managedEventAssignments.templateEventTypeId],
    references: [eventTypes.id],
    relationName: "managed_event_assignments.template_event_type_id",
  }),
  user: one(users, {
    fields: [managedEventAssignments.userId],
    references: [users.id],
    relationName: "managed_event_assignments.user_id",
  }),
  team: one(teams, {
    fields: [managedEventAssignments.teamId],
    references: [teams.id],
    relationName: "managed_event_assignments.team_id",
  }),
  copyEventType: one(eventTypes, {
    fields: [managedEventAssignments.copyEventTypeId],
    references: [eventTypes.id],
    relationName: "managed_event_assignments.copy_event_type_id",
  }),
}));
