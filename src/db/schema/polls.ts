// ARCHITECTURE section 5.4.10 (decision C2: polls are backed by an adhoc event type with booking_method = 'poll').
//
// Poll hosts are the adhoc event type's event_type_hosts (owner plus co-hosts, pool null, pooling_type = 'collective'
// when co-hosts exist); pollAccess grants manage to all of them (MP-01). Poll holds are calendar_linked_events rows with
// purpose = 'poll_hold'. Voter verification codes use verification_codes with purpose = 'poll_vote' and
// context_id = poll id. Vote writes lock the chosen option rows FOR UPDATE in ascending id order inside the vote
// transaction before counting (max_votes_per_option under concurrency); every count joins meeting_poll_options with
// deleted_at is null, so votes on removed options never count.
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
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { LocationConfig } from "../types.ts";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_columns.ts";
import { users } from "./auth.ts";
import { organizations } from "./organizations.ts";
import { eventTypes } from "./event-types.ts";
import { calendarLinkedEvents } from "./calendars.ts";
import { invitees, scheduledEvents } from "./bookings.ts";

export const pollStatus = pgEnum("poll_status", ["open", "closed", "booked", "canceled", "expired"]);
export const pollResultsVisibility = pgEnum("poll_results_visibility", [
  "host_only",
  "counts_only",
  "after_vote",
  "everyone",
]);
export const pollTimeZoneMode = pgEnum("poll_time_zone_mode", ["auto", "fixed"]);
export const pollNotifyMode = pgEnum("poll_notify_mode", ["instant", "daily_digest", "off"]);
export const pollReminderMode = pgEnum("poll_reminder_mode", ["off", "smart", "custom"]);
export const pollVoteChoice = pgEnum("poll_vote_choice", ["yes", "if_need_be", "no"]);
export const pollParticipantStatus = pgEnum("poll_participant_status", ["invited", "responded", "declined"]);
export const pollParticipantSource = pgEnum("poll_participant_source", ["link", "invite", "host_added"]);
export const pollActivityType = pgEnum("poll_activity_type", [
  "created",
  "edited",
  "options_added",
  "options_removed",
  "invited",
  "voted",
  "vote_changed",
  "declined",
  "participant_removed",
  "commented",
  "comment_deleted",
  "reminder_sent",
  "voting_closed",
  "voting_reopened",
  "booked",
  "reopened",
  "rebooked",
  "canceled",
  "expired",
]);

export const meetingPolls = pgTable(
  "meeting_polls",
  {
    id: pk(),
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }), // unique
    organizationId: uuid("organization_id")
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    descriptionHtml: text("description_html"),
    defaultDurationMinutes: integer("default_duration_minutes").notNull(),
    location: jsonb("location").$type<LocationConfig | null>(),
    locale: text("locale").notNull().default("en"),
    timezone: text("timezone").notNull(),
    timeZoneMode: pollTimeZoneMode("time_zone_mode").notNull().default("auto"),
    status: pollStatus("status").notNull().default("open"),
    resultsVisibility: pollResultsVisibility("results_visibility").notNull().default("host_only"),
    allowIfNeedBe: boolean("allow_if_need_be").notNull().default(false), // Calendly is yes/no
    requireEmail: boolean("require_email").notNull().default(true),
    // MP-20 individual invites, independent of results_visibility
    hideInvitees: boolean("hide_invitees").notNull().default(false),
    verifyEmail: boolean("verify_email").notNull().default(false),
    allowComments: boolean("allow_comments").notNull().default(false),
    allowSuggestions: boolean("allow_suggestions").notNull().default(false),
    maxVotesPerOption: integer("max_votes_per_option"),
    maxChoicesPerParticipant: integer("max_choices_per_participant"),
    deadlineAt: ts("deadline_at"),
    reserveTimes: boolean("reserve_times").notNull().default(false),
    notifyMode: pollNotifyMode("notify_mode").notNull().default("instant"),
    reminderMode: pollReminderMode("reminder_mode").notNull().default("smart"),
    reminderOffsets: jsonb("reminder_offsets").$type<
      { kind: "after_invite" | "before_deadline"; minutes: number }[] | null
    >(),
    autoBook: boolean("auto_book").notNull().default(false),
    countHostPreference: boolean("count_host_preference").notNull().default(false),
    hostPreferences: jsonb("host_preferences").$type<Record<string, "yes" | "if_need_be" | "no"> | null>(),
    bookedOptionId: uuid("booked_option_id"),
    bookedScheduledEventId: uuid("booked_scheduled_event_id"),
    bookedAt: ts("booked_at"),
    bookedByUserId: uuid("booked_by_user_id"),
    votingClosedAt: ts("voting_closed_at"),
    reopenedAt: ts("reopened_at"),
    firstInviteSentAt: ts("first_invite_sent_at"),
    hostLastViewedAt: ts("host_last_viewed_at"),
    sendMeetingReminders: boolean("send_meeting_reminders").notNull().default(false),
    canceledAt: ts("canceled_at"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("polls_event_type_uq").on(t.eventTypeId),
    uniqueIndex("polls_slug_uq").on(t.slug),
    index("polls_owner_status_idx").on(t.ownerUserId, t.status, t.createdAt),
    index("polls_open_deadline_idx").on(t.status, t.deadlineAt).where(sql`status = 'open'`),
    index("polls_org_idx").on(t.organizationId),
  ],
);

export const meetingPollOptions = pgTable(
  "meeting_poll_options",
  {
    id: pk(),
    pollId: uuid("poll_id")
      .notNull()
      .references((): AnyPgColumn => meetingPolls.id, { onDelete: "cascade" }),
    startsAt: ts("starts_at"), // null for date-only
    endsAt: ts("ends_at"),
    allDayDate: date("all_day_date", { mode: "string" }),
    durationMinutes: integer("duration_minutes").notNull(),
    position: integer("position").notNull(),
    suggestedByParticipantId: uuid("suggested_by_participant_id"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
  },
  (t) => [
    index("poll_options_start_idx").on(t.pollId, t.startsAt),
    uniqueIndex("poll_options_unique_time_uq")
      .on(t.pollId, t.startsAt, t.endsAt)
      .where(sql`deleted_at is null and starts_at is not null`),
    uniqueIndex("poll_options_unique_day_uq")
      .on(t.pollId, t.allDayDate)
      .where(sql`deleted_at is null and all_day_date is not null`),
    check(
      "poll_option_shape_ck",
      sql`(starts_at is not null and ends_at is not null and all_day_date is null and ends_at > starts_at) or (starts_at is null and ends_at is null and all_day_date is not null)`,
    ),
  ],
);

export const meetingPollParticipants = pgTable(
  "meeting_poll_participants",
  {
    id: pk(),
    pollId: uuid("poll_id")
      .notNull()
      .references((): AnyPgColumn => meetingPolls.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    userId: uuid("user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    timezone: text("timezone"),
    locale: text("locale"),
    status: pollParticipantStatus("status").notNull(),
    source: pollParticipantSource("source").notNull(),
    isRequired: boolean("is_required").notNull().default(false),
    subscribedToUpdates: boolean("subscribed_to_updates").notNull().default(false),
    editTokenHash: text("edit_token_hash").notNull(),
    inviteTokenHash: text("invite_token_hash"),
    emailVerifiedAt: ts("email_verified_at"),
    invitedAt: ts("invited_at"),
    respondedAt: ts("responded_at"),
    lastSubmittedAt: ts("last_submitted_at"),
    reminderCount: integer("reminder_count").notNull().default(0),
    lastRemindedAt: ts("last_reminded_at"),
    unsubscribedAt: ts("unsubscribed_at"),
    createdByUserId: uuid("created_by_user_id"),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("poll_participant_email_uq")
      .on(t.pollId, t.emailNormalized)
      .where(sql`email_normalized is not null and deleted_at is null`),
    index("poll_participants_status_idx").on(t.pollId, t.status),
    uniqueIndex("poll_participant_edit_uq").on(t.editTokenHash),
    uniqueIndex("poll_participant_invite_uq").on(t.inviteTokenHash).where(sql`invite_token_hash is not null`),
    index("poll_participants_user_idx").on(t.userId),
  ],
);

export const meetingPollVotes = pgTable(
  "meeting_poll_votes",
  {
    participantId: uuid("participant_id")
      .notNull()
      .references((): AnyPgColumn => meetingPollParticipants.id, { onDelete: "cascade" }),
    optionId: uuid("option_id")
      .notNull()
      .references((): AnyPgColumn => meetingPollOptions.id, { onDelete: "cascade" }),
    pollId: uuid("poll_id").notNull(), // denormalized
    choice: pollVoteChoice("choice").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.participantId, t.optionId] }),
    index("poll_votes_count_idx").on(t.pollId, t.optionId, t.choice),
    index("poll_votes_option_idx").on(t.optionId),
  ],
);

export const meetingPollComments = pgTable(
  "meeting_poll_comments",
  {
    id: pk(),
    pollId: uuid("poll_id")
      .notNull()
      .references((): AnyPgColumn => meetingPolls.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id"),
    authorUserId: uuid("author_user_id"), // null unless written by a host
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    visibility: text("visibility").notNull(), // 'public' | 'host_only'
    deletedAt: deletedAt(),
    deletedBy: text("deleted_by"),
    createdAt: createdAt(),
  },
  (t) => [index("poll_comments_idx").on(t.pollId, t.createdAt)],
);

export const meetingPollActivity = pgTable(
  "meeting_poll_activity",
  {
    id: pk(),
    pollId: uuid("poll_id")
      .notNull()
      .references((): AnyPgColumn => meetingPolls.id, { onDelete: "cascade" }),
    type: pollActivityType("type").notNull(),
    participantId: uuid("participant_id"),
    actorUserId: uuid("actor_user_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("poll_activity_idx").on(t.pollId, t.createdAt)],
);

export const pollSlugRedirects = pgTable(
  "poll_slug_redirects",
  {
    oldSlug: text("old_slug").primaryKey(),
    pollId: uuid("poll_id")
      .notNull()
      .references((): AnyPgColumn => meetingPolls.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("poll_slug_redirects_poll_idx").on(t.pollId)],
);

export const meetingPollsRelations = relations(meetingPolls, ({ one, many }) => ({
  eventType: one(eventTypes, {
    fields: [meetingPolls.eventTypeId],
    references: [eventTypes.id],
    relationName: "meeting_polls.event_type_id",
  }),
  organization: one(organizations, {
    fields: [meetingPolls.organizationId],
    references: [organizations.id],
    relationName: "meeting_polls.organization_id",
  }),
  owner: one(users, {
    fields: [meetingPolls.ownerUserId],
    references: [users.id],
    relationName: "meeting_polls.owner_user_id",
  }),
  options: many(meetingPollOptions, { relationName: "meeting_poll_options.poll_id" }),
  participants: many(meetingPollParticipants, { relationName: "meeting_poll_participants.poll_id" }),
  comments: many(meetingPollComments, { relationName: "meeting_poll_comments.poll_id" }),
  activity: many(meetingPollActivity, { relationName: "meeting_poll_activity.poll_id" }),
  slugRedirects: many(pollSlugRedirects, { relationName: "poll_slug_redirects.poll_id" }),
  scheduledEvents: many(scheduledEvents, { relationName: "scheduled_events.poll_id" }),
  linkedCalendarEvents: many(calendarLinkedEvents, { relationName: "calendar_linked_events.poll_id" }),
}));

export const meetingPollOptionsRelations = relations(meetingPollOptions, ({ one, many }) => ({
  poll: one(meetingPolls, {
    fields: [meetingPollOptions.pollId],
    references: [meetingPolls.id],
    relationName: "meeting_poll_options.poll_id",
  }),
  votes: many(meetingPollVotes, { relationName: "meeting_poll_votes.option_id" }),
  linkedCalendarEvents: many(calendarLinkedEvents, { relationName: "calendar_linked_events.poll_option_id" }),
}));

export const meetingPollParticipantsRelations = relations(meetingPollParticipants, ({ one, many }) => ({
  poll: one(meetingPolls, {
    fields: [meetingPollParticipants.pollId],
    references: [meetingPolls.id],
    relationName: "meeting_poll_participants.poll_id",
  }),
  user: one(users, {
    fields: [meetingPollParticipants.userId],
    references: [users.id],
    relationName: "meeting_poll_participants.user_id",
  }),
  votes: many(meetingPollVotes, { relationName: "meeting_poll_votes.participant_id" }),
  invitees: many(invitees, { relationName: "invitees.poll_participant_id" }),
}));

export const meetingPollVotesRelations = relations(meetingPollVotes, ({ one }) => ({
  participant: one(meetingPollParticipants, {
    fields: [meetingPollVotes.participantId],
    references: [meetingPollParticipants.id],
    relationName: "meeting_poll_votes.participant_id",
  }),
  option: one(meetingPollOptions, {
    fields: [meetingPollVotes.optionId],
    references: [meetingPollOptions.id],
    relationName: "meeting_poll_votes.option_id",
  }),
}));

export const meetingPollCommentsRelations = relations(meetingPollComments, ({ one }) => ({
  poll: one(meetingPolls, {
    fields: [meetingPollComments.pollId],
    references: [meetingPolls.id],
    relationName: "meeting_poll_comments.poll_id",
  }),
}));

export const meetingPollActivityRelations = relations(meetingPollActivity, ({ one }) => ({
  poll: one(meetingPolls, {
    fields: [meetingPollActivity.pollId],
    references: [meetingPolls.id],
    relationName: "meeting_poll_activity.poll_id",
  }),
}));

export const pollSlugRedirectsRelations = relations(pollSlugRedirects, ({ one }) => ({
  poll: one(meetingPolls, {
    fields: [pollSlugRedirects.pollId],
    references: [meetingPolls.id],
    relationName: "poll_slug_redirects.poll_id",
  }),
}));
