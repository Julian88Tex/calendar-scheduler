// ARCHITECTURE section 5.4.8: scheduled events (Calendly scheduled_event), their hosts (event_memberships, also the
// busy index), invitees, guests, no-shows, reservations (payment and email verification holds), activity and blocks.
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
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { MeetingSettingsSnapshot, QuestionAnswer, ResolvedLocation } from "../types.ts";
import { createdAt, pk, ts, updatedAt } from "./_columns.ts";
import { actorType } from "./_enums.ts";
import { users } from "./auth.ts";
import { organizations } from "./organizations.ts";
import { eventTypeHostPools, eventTypes } from "./event-types.ts";
import { calendarLinkedEvents } from "./calendars.ts";
import { oneOffMeetings, singleUseLinks } from "./links.ts";
import { meetingPollParticipants, meetingPolls } from "./polls.ts";
import { workflowExecutions } from "./workflows.ts";
import { routingFormSubmissions } from "./routing.ts";
import { contacts } from "./contacts.ts";
import { payments } from "./payments.ts";

export { actorType };

export const scheduledEventStatus = pgEnum("scheduled_event_status", ["active", "canceled"]);
export const inviteeStatus = pgEnum("invitee_status", ["active", "canceled"]);
export const cancelerType = pgEnum("canceler_type", ["host", "invitee", "system"]);
export const bookingSource = pgEnum("booking_source", [
  "booking_page",
  "single_use_link",
  "one_off",
  "poll",
  "host",
  "api",
  "routing_form",
  "calendar_sync",
]);
/** null = invitee self-serve (Calendly parity) */
export const schedulingMethod = pgEnum("scheduling_method", ["instant_book", "api"]);
export const eventHostRole = pgEnum("event_host_role", ["organizer", "cohost", "assigned"]);
export const provisionStatus = pgEnum("provision_status", ["pending", "done", "partial", "failed"]);
export const reservationKind = pgEnum("reservation_kind", ["payment", "email_verification"]);
export const reservationStatus = pgEnum("reservation_status", ["pending", "completed", "expired", "canceled"]);
export const meetingActivityType = pgEnum("meeting_activity_type", [
  "booked",
  "rescheduled_from",
  "rescheduled_to",
  "canceled",
  "invitee_canceled",
  "invitee_added",
  "invitee_removed",
  "no_show_marked",
  "no_show_unmarked",
  "notes_updated",
  "email_sent",
  "email_failed",
  "sms_sent",
  "sms_failed",
  "calendar_synced",
  "calendar_failed",
  "conference_created",
  "conference_failed",
  "notification_fallback",
  "reconfirmation_requested",
  "reconfirmed",
  "payment_succeeded",
  "payment_refunded",
  "host_reassigned",
  "invitee_limit_changed",
  "location_changed",
  "buffers_changed",
  "workflow_sent",
  "workflow_skipped",
]);

export const scheduledEvents = pgTable(
  "scheduled_events",
  {
    id: pk(), // public capability id: /events/{id}/join
    organizationId: uuid("organization_id")
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: scheduledEventStatus("status").notNull().default("active"),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    isGroup: boolean("is_group").notNull().default(false),
    inviteesLimit: integer("invitees_limit").notNull().default(1),
    location: jsonb("location").$type<ResolvedLocation>().notNull(),
    organizerUserId: uuid("organizer_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "restrict" }),
    source: bookingSource("source").notNull().default("booking_page"),
    singleUseLinkId: uuid("single_use_link_id").references((): AnyPgColumn => singleUseLinks.id, { onDelete: "set null" }),
    oneOffMeetingId: uuid("one_off_meeting_id").references((): AnyPgColumn => oneOffMeetings.id, { onDelete: "set null" }),
    pollId: uuid("poll_id").references((): AnyPgColumn => meetingPolls.id, { onDelete: "set null" }),
    settingsSnapshot: jsonb("settings_snapshot").$type<MeetingSettingsSnapshot>().notNull(),
    meetingNotesHtml: text("meeting_notes_html"),
    meetingNotesPlain: text("meeting_notes_plain"),
    icsUid: text("ics_uid").notNull(),
    icsSequence: integer("ics_sequence").notNull().default(0),
    // Google iCalUID / Graph iCalUId of the organizer's provider event (CAL-12); ICS uses it when
    // notificationMode = calendar_invitation
    providerIcalUid: text("provider_ical_uid"),
    // Google htmlLink / Graph webLink for "Open Invitation" (BK-20)
    invitationUrl: text("invitation_url"),
    rescheduledFromEventId: uuid("rescheduled_from_event_id").references((): AnyPgColumn => scheduledEvents.id, {
      onDelete: "set null",
    }),
    provisionStatus: provisionStatus("provision_status").notNull().default("pending"),
    provisionError: text("provision_error"),
    provisionedAt: ts("provisioned_at"),
    canceledAt: ts("canceled_at"),
    cancelReason: text("cancel_reason"),
    cancelerType: cancelerType("canceler_type"),
    canceledByUserId: uuid("canceled_by_user_id"),
    canceledByName: text("canceled_by_name"),
    locale: text("locale").notNull().default("en"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sched_org_start_idx").on(t.organizationId, t.startAt),
    index("sched_type_start_idx").on(t.eventTypeId, t.startAt),
    index("sched_organizer_start_idx").on(t.organizerUserId, t.startAt),
    index("sched_poll_idx").on(t.pollId),
    index("sched_single_use_idx").on(t.singleUseLinkId),
    index("sched_one_off_idx").on(t.oneOffMeetingId),
    index("sched_rescheduled_from_idx").on(t.rescheduledFromEventId),
    uniqueIndex("sched_group_slot_uq").on(t.eventTypeId, t.startAt).where(sql`status = 'active' and is_group`),
    uniqueIndex("sched_poll_active_uq").on(t.pollId).where(sql`status = 'active' and poll_id is not null`),
    uniqueIndex("sched_one_off_active_uq")
      .on(t.oneOffMeetingId)
      .where(sql`status = 'active' and one_off_meeting_id is not null`),
    check("sched_times_ck", sql`end_at > start_at`),
  ],
);

/** Calendly event_memberships; also the busy index. */
export const scheduledEventHosts = pgTable(
  "scheduled_event_hosts",
  {
    id: pk(),
    scheduledEventId: uuid("scheduled_event_id")
      .notNull()
      .references((): AnyPgColumn => scheduledEvents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "restrict" }),
    eventTypeId: uuid("event_type_id").notNull(), // denormalized
    poolId: uuid("pool_id").references((): AnyPgColumn => eventTypeHostPools.id, { onDelete: "set null" }),
    role: eventHostRole("role").notNull(),
    isActive: boolean("is_active").notNull().default(true), // false when the meeting is canceled
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    bufferedStartAt: ts("buffered_start_at").notNull(),
    bufferedEndAt: ts("buffered_end_at").notNull(),
    // 'priority' | 'least_recent' | 'random' | 'equal' | 'manual' | 'same_host'
    assignmentReason: text("assignment_reason"),
    // Set explicitly at assignment; copied unchanged to the new row on reschedule (SCH-16 least recent).
    assignedAt: ts("assigned_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sched_hosts_uq").on(t.scheduledEventId, t.userId),
    index("sched_hosts_busy_idx").on(t.userId, t.isActive, t.bufferedStartAt, t.bufferedEndAt),
    index("sched_hosts_rr_idx")
      .on(t.eventTypeId, t.poolId, t.userId, t.assignedAt)
      .where(sql`role = 'assigned' and is_active`),
    index("sched_hosts_pool_idx").on(t.poolId),
  ],
);

export const invitees = pgTable(
  "invitees",
  {
    id: pk(), // public capability id: /cancellations/{id}, /reschedulings/{id}, /booking/{id}
    scheduledEventId: uuid("scheduled_event_id")
      .notNull()
      .references((): AnyPgColumn => scheduledEvents.id, { onDelete: "cascade" }),
    eventTypeId: uuid("event_type_id").notNull(), // denormalized
    organizationId: uuid("organization_id").notNull(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    name: text("name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    // Zone the invitee saw (locked zone for locked events), used for every invitee message (GEN-06).
    timezone: text("timezone"),
    detectedTimezone: text("detected_timezone"), // browser zone at booking
    timeFormat: text("time_format"), // '12h' | '24h' chosen on the booking page
    locale: text("locale"),
    status: inviteeStatus("status").notNull().default("active"),
    questionsAndAnswers: jsonb("questions_and_answers").$type<QuestionAnswer[]>().notNull().default([]),
    locationAnswer: jsonb("location_answer").$type<{ configId: string; value: string | null } | null>(),
    textReminderNumber: text("text_reminder_number"), // E.164
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    salesforceUuid: text("salesforce_uuid"),
    rescheduled: boolean("rescheduled").notNull().default(false),
    oldInviteeId: uuid("old_invitee_id"),
    newInviteeId: uuid("new_invitee_id"),
    routingFormSubmissionId: uuid("routing_form_submission_id").references((): AnyPgColumn => routingFormSubmissions.id, {
      onDelete: "set null",
    }),
    pollParticipantId: uuid("poll_participant_id").references((): AnyPgColumn => meetingPollParticipants.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references((): AnyPgColumn => contacts.id, { onDelete: "set null" }),
    schedulingMethod: schedulingMethod("scheduling_method"),
    scheduledByUserId: uuid("scheduled_by_user_id"),
    reconfirmationRequestedAt: ts("reconfirmation_requested_at"),
    reconfirmedAt: ts("reconfirmed_at"),
    canceledAt: ts("canceled_at"),
    cancelReason: text("cancel_reason"),
    cancelerType: cancelerType("canceler_type"),
    canceledByUserId: uuid("canceled_by_user_id"),
    canceledByName: text("canceled_by_name"),
    rescheduleReason: text("reschedule_reason"),
    emailVerifiedAt: ts("email_verified_at"),
    ipHash: text("ip_hash"),
    anonymizedAt: ts("anonymized_at"),
    clientRequestId: text("client_request_id"), // BK-19 double-submit idempotency
    // The reservation this invitee completed (at most one invitee per reservation).
    reservationId: uuid("reservation_id").references((): AnyPgColumn => bookingReservations.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("invitees_event_idx").on(t.scheduledEventId),
    index("invitees_email_idx").on(t.emailNormalized),
    uniqueIndex("invitees_client_request_uq").on(t.clientRequestId).where(sql`client_request_id is not null`),
    uniqueIndex("invitees_reservation_uq").on(t.reservationId).where(sql`reservation_id is not null`),
    // one new invitee per old invitee
    uniqueIndex("invitees_old_invitee_uq").on(t.oldInviteeId).where(sql`old_invitee_id is not null`),
    index("invitees_new_invitee_idx").on(t.newInviteeId),
    index("invitees_org_created_idx").on(t.organizationId, t.createdAt),
    index("invitees_type_created_idx").on(t.eventTypeId, t.createdAt),
    index("invitees_contact_idx").on(t.contactId),
    index("invitees_routing_idx").on(t.routingFormSubmissionId),
    index("invitees_poll_participant_idx").on(t.pollParticipantId),
  ],
);

export const inviteeGuests = pgTable(
  "invitee_guests",
  {
    id: pk(),
    inviteeId: uuid("invitee_id")
      .notNull()
      .references((): AnyPgColumn => invitees.id, { onDelete: "cascade" }),
    scheduledEventId: uuid("scheduled_event_id")
      .notNull()
      .references((): AnyPgColumn => scheduledEvents.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    canceledAt: ts("canceled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("guests_invitee_idx").on(t.inviteeId), index("guests_event_idx").on(t.scheduledEventId)],
);

export const inviteeNoShows = pgTable(
  "invitee_no_shows",
  {
    id: pk(),
    inviteeId: uuid("invitee_id")
      .notNull()
      .references((): AnyPgColumn => invitees.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("no_shows_invitee_uq").on(t.inviteeId)],
);

/** Payment and email verification holds (SCH-19), created under host locks (section 9). */
export const bookingReservations = pgTable(
  "booking_reservations",
  {
    id: pk(),
    kind: reservationKind("kind").notNull(),
    status: reservationStatus("status").notNull().default("pending"),
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    targetKind: text("target_kind").notNull(), // 'event_type' | 'single_use' | 'one_off' | 'shared'
    targetId: uuid("target_id").notNull(),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    bufferedStartAt: ts("buffered_start_at").notNull(),
    bufferedEndAt: ts("buffered_end_at").notNull(),
    // Exactly the hosts the meeting would have: all hosts, or required co-hosts plus the provisional assignee per pool
    // (round robin).
    hostUserIds: uuid("host_user_ids").array().notNull(),
    // Round robin provisional assignment.
    assignment: jsonb("assignment").$type<{
      organizerId: string;
      byPool: Record<string, { userId: string; reason: string }>;
    } | null>(),
    // Counts as one seat of the group slot (event_type_id, start_at).
    isGroupSeat: boolean("is_group_seat").notNull().default(false),
    inviteeEmailNormalized: text("invitee_email_normalized").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), // validated booking input
    // 10 minutes; Checkout path: the Stripe session expiry (30 minutes)
    expiresAt: ts("expires_at").notNull(),
    completedInviteeId: uuid("completed_invitee_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("reservations_status_exp_idx").on(t.status, t.expiresAt),
    index("reservations_type_start_idx").on(t.eventTypeId, t.startAt),
    // "pending holds for these hosts": host_user_ids && $ids
    index("reservations_hosts_gin").using("gin", t.hostUserIds).where(sql`status = 'pending'`),
  ],
);

export const meetingActivity = pgTable(
  "meeting_activity",
  {
    id: pk(),
    scheduledEventId: uuid("scheduled_event_id")
      .notNull()
      .references((): AnyPgColumn => scheduledEvents.id, { onDelete: "cascade" }),
    inviteeId: uuid("invitee_id"),
    type: meetingActivityType("type").notNull(),
    actorType: actorType("actor_type").notNull().default("system"),
    actorUserId: uuid("actor_user_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("meeting_activity_event_idx").on(t.scheduledEventId, t.createdAt)],
);

export const blockedInvitees = pgTable(
  "blocked_invitees",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }), // blocking host
    email: text("email"),
    emailNormalized: text("email_normalized"),
    domain: text("domain"), // lowercase
    reason: text("reason"),
    sourceInviteeId: uuid("source_invitee_id"),
    createdAt: createdAt(),
  },
  (t) => [
    check("blocked_one_target", sql`num_nonnulls(email_normalized, domain) = 1`),
    uniqueIndex("blocked_email_uq").on(t.userId, t.emailNormalized).where(sql`email_normalized is not null`),
    uniqueIndex("blocked_domain_uq").on(t.userId, t.domain).where(sql`domain is not null`),
    index("blocked_user_idx").on(t.userId),
  ],
);

export const scheduledEventsRelations = relations(scheduledEvents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [scheduledEvents.organizationId],
    references: [organizations.id],
    relationName: "scheduled_events.organization_id",
  }),
  eventType: one(eventTypes, {
    fields: [scheduledEvents.eventTypeId],
    references: [eventTypes.id],
    relationName: "scheduled_events.event_type_id",
  }),
  organizer: one(users, {
    fields: [scheduledEvents.organizerUserId],
    references: [users.id],
    relationName: "scheduled_events.organizer_user_id",
  }),
  singleUseLink: one(singleUseLinks, {
    fields: [scheduledEvents.singleUseLinkId],
    references: [singleUseLinks.id],
    relationName: "scheduled_events.single_use_link_id",
  }),
  oneOffMeeting: one(oneOffMeetings, {
    fields: [scheduledEvents.oneOffMeetingId],
    references: [oneOffMeetings.id],
    relationName: "scheduled_events.one_off_meeting_id",
  }),
  poll: one(meetingPolls, {
    fields: [scheduledEvents.pollId],
    references: [meetingPolls.id],
    relationName: "scheduled_events.poll_id",
  }),
  rescheduledFrom: one(scheduledEvents, {
    fields: [scheduledEvents.rescheduledFromEventId],
    references: [scheduledEvents.id],
    relationName: "scheduled_events.rescheduled_from_event_id",
  }),
  rescheduledTo: many(scheduledEvents, { relationName: "scheduled_events.rescheduled_from_event_id" }),
  hosts: many(scheduledEventHosts, { relationName: "scheduled_event_hosts.scheduled_event_id" }),
  invitees: many(invitees, { relationName: "invitees.scheduled_event_id" }),
  guests: many(inviteeGuests, { relationName: "invitee_guests.scheduled_event_id" }),
  activity: many(meetingActivity, { relationName: "meeting_activity.scheduled_event_id" }),
  linkedCalendarEvents: many(calendarLinkedEvents, { relationName: "calendar_linked_events.scheduled_event_id" }),
  workflowExecutions: many(workflowExecutions, { relationName: "workflow_executions.scheduled_event_id" }),
  payments: many(payments, { relationName: "payments.scheduled_event_id" }),
}));

export const scheduledEventHostsRelations = relations(scheduledEventHosts, ({ one }) => ({
  scheduledEvent: one(scheduledEvents, {
    fields: [scheduledEventHosts.scheduledEventId],
    references: [scheduledEvents.id],
    relationName: "scheduled_event_hosts.scheduled_event_id",
  }),
  user: one(users, {
    fields: [scheduledEventHosts.userId],
    references: [users.id],
    relationName: "scheduled_event_hosts.user_id",
  }),
  pool: one(eventTypeHostPools, {
    fields: [scheduledEventHosts.poolId],
    references: [eventTypeHostPools.id],
    relationName: "scheduled_event_hosts.pool_id",
  }),
}));

export const inviteesRelations = relations(invitees, ({ one, many }) => ({
  scheduledEvent: one(scheduledEvents, {
    fields: [invitees.scheduledEventId],
    references: [scheduledEvents.id],
    relationName: "invitees.scheduled_event_id",
  }),
  routingFormSubmission: one(routingFormSubmissions, {
    fields: [invitees.routingFormSubmissionId],
    references: [routingFormSubmissions.id],
    relationName: "invitees.routing_form_submission_id",
  }),
  pollParticipant: one(meetingPollParticipants, {
    fields: [invitees.pollParticipantId],
    references: [meetingPollParticipants.id],
    relationName: "invitees.poll_participant_id",
  }),
  contact: one(contacts, { fields: [invitees.contactId], references: [contacts.id], relationName: "invitees.contact_id" }),
  reservation: one(bookingReservations, {
    fields: [invitees.reservationId],
    references: [bookingReservations.id],
    relationName: "invitees.reservation_id",
  }),
  guests: many(inviteeGuests, { relationName: "invitee_guests.invitee_id" }),
  noShow: one(inviteeNoShows),
  workflowExecutions: many(workflowExecutions, { relationName: "workflow_executions.invitee_id" }),
  payments: many(payments, { relationName: "payments.invitee_id" }),
}));

export const inviteeGuestsRelations = relations(inviteeGuests, ({ one }) => ({
  invitee: one(invitees, {
    fields: [inviteeGuests.inviteeId],
    references: [invitees.id],
    relationName: "invitee_guests.invitee_id",
  }),
  scheduledEvent: one(scheduledEvents, {
    fields: [inviteeGuests.scheduledEventId],
    references: [scheduledEvents.id],
    relationName: "invitee_guests.scheduled_event_id",
  }),
}));

export const inviteeNoShowsRelations = relations(inviteeNoShows, ({ one }) => ({
  invitee: one(invitees, {
    fields: [inviteeNoShows.inviteeId],
    references: [invitees.id],
    relationName: "invitee_no_shows.invitee_id",
  }),
}));

export const bookingReservationsRelations = relations(bookingReservations, ({ one, many }) => ({
  eventType: one(eventTypes, {
    fields: [bookingReservations.eventTypeId],
    references: [eventTypes.id],
    relationName: "booking_reservations.event_type_id",
  }),
  invitee: one(invitees),
  payments: many(payments, { relationName: "payments.reservation_id" }),
}));

export const meetingActivityRelations = relations(meetingActivity, ({ one }) => ({
  scheduledEvent: one(scheduledEvents, {
    fields: [meetingActivity.scheduledEventId],
    references: [scheduledEvents.id],
    relationName: "meeting_activity.scheduled_event_id",
  }),
}));

export const blockedInviteesRelations = relations(blockedInvitees, ({ one }) => ({
  user: one(users, { fields: [blockedInvitees.userId], references: [users.id], relationName: "blocked_invitees.user_id" }),
}));
