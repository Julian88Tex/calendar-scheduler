// ARCHITECTURE section 5.4.6: calendar connections, calendars, busy cache (sync windows and external events), events
// this app created on provider calendars, and push notification channels.
import { relations, sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, date, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_columns.ts";
import { connectionStatus } from "./_enums.ts";
import { oauthAccounts, users } from "./auth.ts";
import { eventTypes } from "./event-types.ts";
import { scheduledEvents } from "./bookings.ts";
import { oneOffMeetings, oneOffMeetingSpots } from "./links.ts";
import { meetingPollOptions, meetingPolls } from "./polls.ts";

export { connectionStatus };

// calendly_import (CAL-22): read-only connection whose external_events rows are written by the BR-17 importer and never
// refetched.
export const calendarProvider = pgEnum("calendar_provider", ["google", "microsoft", "caldav", "ics", "calendly_import"]);
export const linkedEventPurpose = pgEnum("linked_event_purpose", [
  "meeting",
  "buffer_before",
  "buffer_after",
  "one_off_hold",
  "poll_hold",
]);
export const linkedEventStatus = pgEnum("linked_event_status", ["pending", "synced", "failed", "deleted"]);

export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    provider: calendarProvider("provider").notNull(),
    accountEmail: text("account_email"),
    displayName: text("display_name"),
    // Google sub, Microsoft oid, CalDAV principal URL, ICS url hash
    providerAccountId: text("provider_account_id"),
    // connection created by sign-in
    oauthAccountId: uuid("oauth_account_id").references((): AnyPgColumn => oauthAccounts.id, { onDelete: "set null" }),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: ts("token_expires_at"),
    scopes: text("scopes").array().notNull().default([]),
    caldavServerUrl: text("caldav_server_url"),
    caldavUsername: text("caldav_username"),
    caldavPasswordEnc: text("caldav_password_enc"),
    caldavPrincipalUrl: text("caldav_principal_url"),
    icsUrlEnc: text("ics_url_enc"),
    icsEtag: text("ics_etag"),
    icsLastModified: text("ics_last_modified"),
    status: connectionStatus("status").notNull().default("active"),
    lastError: text("last_error"),
    lastErrorAt: ts("last_error_at"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastSyncedAt: ts("last_synced_at"),
    problemNotifiedAt: ts("problem_notified_at"),
    // Microsoft showAs values that count as busy
    unavailableStatuses: text("unavailable_statuses")
      .array()
      .notNull()
      .default(["busy", "tentative", "oof", "workingElsewhere"]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("cal_conn_user_idx").on(t.userId),
    uniqueIndex("cal_conn_account_uq")
      .on(t.userId, t.provider, t.providerAccountId)
      .where(sql`provider_account_id is not null and status <> 'disconnected'`),
    index("cal_conn_oauth_account_idx").on(t.oauthAccountId),
  ],
);

export const calendars = pgTable(
  "calendars",
  {
    id: pk(),
    connectionId: uuid("connection_id")
      .notNull()
      .references((): AnyPgColumn => calendarConnections.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }), // denormalized
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    timezone: text("timezone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    canWrite: boolean("can_write").notNull().default(false),
    checkConflicts: boolean("check_conflicts").notNull().default(false),
    includeBuffers: boolean("include_buffers").notNull().default(false),
    syncChanges: boolean("sync_changes").notNull().default(true), // CAL-14
    syncToken: text("sync_token"),
    ctag: text("ctag"),
    allowedOnlineMeetingProviders: text("allowed_online_meeting_providers").array().notNull().default([]),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("calendars_conn_ext_uq").on(t.connectionId, t.externalId),
    index("calendars_user_conflicts_idx").on(t.userId, t.checkConflicts),
  ],
);

/** Which ranges of external_events are cached and how fresh (section 10.3). */
export const calendarSyncWindows = pgTable(
  "calendar_sync_windows",
  {
    id: pk(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references((): AnyPgColumn => calendars.id, { onDelete: "cascade" }),
    windowStart: ts("window_start").notNull(),
    windowEnd: ts("window_end").notNull(),
    fetchedAt: ts("fetched_at").notNull(),
    status: text("status").notNull(), // 'ok' | 'error'
    error: text("error"),
    fetchLeaseUntil: ts("fetch_lease_until"), // single-flight lease, section 10.3
    fetchLeaseHolder: text("fetch_lease_holder"),
  },
  (t) => [
    uniqueIndex("sync_windows_uq").on(t.calendarId, t.windowStart, t.windowEnd),
    index("sync_windows_fetched_idx").on(t.calendarId, t.fetchedAt),
  ],
);

/** Cached, expanded instances of provider events. */
export const externalEvents = pgTable(
  "external_events",
  {
    id: pk(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references((): AnyPgColumn => calendars.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(), // denormalized
    externalId: text("external_id").notNull(),
    icalUid: text("ical_uid"),
    recurringEventId: text("recurring_event_id"),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    allDay: boolean("all_day").notNull().default(false),
    allDayStartDate: date("all_day_start_date", { mode: "string" }),
    allDayEndDate: date("all_day_end_date", { mode: "string" }), // exclusive
    title: text("title"),
    busy: boolean("busy").notNull(),
    showAs: text("show_as"),
    status: text("status"),
    isOwn: boolean("is_own").notNull().default(false), // created by this app (CAL-18)
    remoteUpdatedAt: ts("remote_updated_at"),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("external_events_uq").on(t.calendarId, t.externalId, t.startAt),
    index("external_events_user_range_idx").on(t.userId, t.startAt, t.endAt),
    index("external_events_cal_start_idx").on(t.calendarId, t.startAt),
  ],
);

/** Provider events this app created. */
export const calendarLinkedEvents = pgTable(
  "calendar_linked_events",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references((): AnyPgColumn => calendarConnections.id, { onDelete: "set null" }),
    calendarId: uuid("calendar_id").references((): AnyPgColumn => calendars.id, { onDelete: "set null" }),
    purpose: linkedEventPurpose("purpose").notNull(),
    scheduledEventId: uuid("scheduled_event_id").references((): AnyPgColumn => scheduledEvents.id, { onDelete: "cascade" }),
    oneOffMeetingId: uuid("one_off_meeting_id").references((): AnyPgColumn => oneOffMeetings.id, { onDelete: "cascade" }),
    pollId: uuid("poll_id").references((): AnyPgColumn => meetingPolls.id, { onDelete: "cascade" }),
    pollOptionId: uuid("poll_option_id").references((): AnyPgColumn => meetingPollOptions.id, { onDelete: "cascade" }),
    oneOffSpotId: uuid("one_off_spot_id").references((): AnyPgColumn => oneOffMeetingSpots.id, { onDelete: "cascade" }),
    externalId: text("external_id"), // null until created
    icalUid: text("ical_uid"),
    etag: text("etag"),
    syncedStartAt: ts("synced_start_at"), // last known provider start (CAL-14 change detection)
    syncedEndAt: ts("synced_end_at"),
    status: linkedEventStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lastCheckedAt: ts("last_checked_at"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("linked_events_idem_uq").on(t.idempotencyKey),
    index("linked_events_event_idx").on(t.scheduledEventId),
    index("linked_events_conn_status_idx").on(t.connectionId, t.status),
    index("linked_events_poll_idx").on(t.pollId),
    index("linked_events_one_off_idx").on(t.oneOffMeetingId),
    index("linked_events_cal_ext_idx").on(t.calendarId, t.externalId),
    index("linked_events_user_idx").on(t.userId),
    index("linked_events_poll_option_idx").on(t.pollOptionId),
    index("linked_events_one_off_spot_idx").on(t.oneOffSpotId),
  ],
);

/** P3 push notifications (Google events.watch, Graph subscriptions). */
export const calendarWatchChannels = pgTable(
  "calendar_watch_channels",
  {
    id: pk(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references((): AnyPgColumn => calendars.id, { onDelete: "cascade" }),
    provider: calendarProvider("provider").notNull(),
    channelId: text("channel_id").notNull(),
    resourceId: text("resource_id"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("watch_channel_uq").on(t.channelId), index("watch_channels_calendar_idx").on(t.calendarId)],
);

export const calendarConnectionsRelations = relations(calendarConnections, ({ one, many }) => ({
  user: one(users, {
    fields: [calendarConnections.userId],
    references: [users.id],
    relationName: "calendar_connections.user_id",
  }),
  oauthAccount: one(oauthAccounts, {
    fields: [calendarConnections.oauthAccountId],
    references: [oauthAccounts.id],
    relationName: "calendar_connections.oauth_account_id",
  }),
  calendars: many(calendars, { relationName: "calendars.connection_id" }),
  linkedEvents: many(calendarLinkedEvents, { relationName: "calendar_linked_events.connection_id" }),
}));

export const calendarsRelations = relations(calendars, ({ one, many }) => ({
  connection: one(calendarConnections, {
    fields: [calendars.connectionId],
    references: [calendarConnections.id],
    relationName: "calendars.connection_id",
  }),
  user: one(users, { fields: [calendars.userId], references: [users.id], relationName: "calendars.user_id" }),
  destinationForUsers: many(users, { relationName: "users.destination_calendar_id" }),
  destinationForEventTypes: many(eventTypes, { relationName: "event_types.destination_calendar_id" }),
  syncWindows: many(calendarSyncWindows, { relationName: "calendar_sync_windows.calendar_id" }),
  externalEvents: many(externalEvents, { relationName: "external_events.calendar_id" }),
  linkedEvents: many(calendarLinkedEvents, { relationName: "calendar_linked_events.calendar_id" }),
  watchChannels: many(calendarWatchChannels, { relationName: "calendar_watch_channels.calendar_id" }),
}));

export const calendarSyncWindowsRelations = relations(calendarSyncWindows, ({ one }) => ({
  calendar: one(calendars, {
    fields: [calendarSyncWindows.calendarId],
    references: [calendars.id],
    relationName: "calendar_sync_windows.calendar_id",
  }),
}));

export const externalEventsRelations = relations(externalEvents, ({ one }) => ({
  calendar: one(calendars, {
    fields: [externalEvents.calendarId],
    references: [calendars.id],
    relationName: "external_events.calendar_id",
  }),
}));

export const calendarLinkedEventsRelations = relations(calendarLinkedEvents, ({ one }) => ({
  user: one(users, {
    fields: [calendarLinkedEvents.userId],
    references: [users.id],
    relationName: "calendar_linked_events.user_id",
  }),
  connection: one(calendarConnections, {
    fields: [calendarLinkedEvents.connectionId],
    references: [calendarConnections.id],
    relationName: "calendar_linked_events.connection_id",
  }),
  calendar: one(calendars, {
    fields: [calendarLinkedEvents.calendarId],
    references: [calendars.id],
    relationName: "calendar_linked_events.calendar_id",
  }),
  scheduledEvent: one(scheduledEvents, {
    fields: [calendarLinkedEvents.scheduledEventId],
    references: [scheduledEvents.id],
    relationName: "calendar_linked_events.scheduled_event_id",
  }),
  oneOffMeeting: one(oneOffMeetings, {
    fields: [calendarLinkedEvents.oneOffMeetingId],
    references: [oneOffMeetings.id],
    relationName: "calendar_linked_events.one_off_meeting_id",
  }),
  poll: one(meetingPolls, {
    fields: [calendarLinkedEvents.pollId],
    references: [meetingPolls.id],
    relationName: "calendar_linked_events.poll_id",
  }),
  pollOption: one(meetingPollOptions, {
    fields: [calendarLinkedEvents.pollOptionId],
    references: [meetingPollOptions.id],
    relationName: "calendar_linked_events.poll_option_id",
  }),
  oneOffSpot: one(oneOffMeetingSpots, {
    fields: [calendarLinkedEvents.oneOffSpotId],
    references: [oneOffMeetingSpots.id],
    relationName: "calendar_linked_events.one_off_spot_id",
  }),
}));

export const calendarWatchChannelsRelations = relations(calendarWatchChannels, ({ one }) => ({
  calendar: one(calendars, {
    fields: [calendarWatchChannels.calendarId],
    references: [calendars.id],
    relationName: "calendar_watch_channels.calendar_id",
  }),
}));
