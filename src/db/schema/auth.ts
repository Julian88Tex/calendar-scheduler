// ARCHITECTURE section 5.4.1: users, sessions, OAuth accounts, tokens, codes, secrets, instance settings, rate limits.
import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
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
import { DEFAULT_NOTIFICATION_PREFS } from "../types.ts";
import type { BrandColors, LocationConfig, NotificationPrefs, UserPreferences } from "../types.ts";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_columns.ts";
import { files } from "./files.ts";
import {
  groupMemberships,
  handles,
  organizationInvitations,
  organizationMemberships,
  teamMemberships,
} from "./organizations.ts";
import { availabilityShares, oneOffMeetings, singleUseLinks } from "./links.ts";
import { availabilitySchedules, userHolidayOverrides } from "./availability.ts";
import { eventTypeHosts, eventTypePermissions, eventTypes, managedEventAssignments } from "./event-types.ts";
import { calendarConnections, calendarLinkedEvents, calendars } from "./calendars.ts";
import { conferencingConnections } from "./conferencing.ts";
import { blockedInvitees, scheduledEventHosts, scheduledEvents } from "./bookings.ts";
import { meetingPollParticipants, meetingPolls } from "./polls.ts";
import { workflows } from "./workflows.ts";
import { routingFormPermissions, routingForms } from "./routing.ts";
import { contactCustomFieldDefinitions, contactLists, contactNotes, contacts } from "./contacts.ts";
import { apiTokens, calendarFeeds, webhookSubscriptions } from "./developer.ts";
import { coupons } from "./payments.ts";
import { importMappings, importRuns } from "./imports.ts";

export const oauthProvider = pgEnum("oauth_provider", ["google", "microsoft"]);
export const authTokenPurpose = pgEnum("auth_token_purpose", [
  "password_reset",
  "email_verification",
  "email_change",
  "login_method_change",
]);
export const verificationPurpose = pgEnum("verification_purpose", [
  "booking",
  "poll_vote",
  "login_method_change",
  "phone_verification",
]);

export const DEFAULT_WELCOME_MESSAGE =
  "Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.";

export const users = pgTable(
  "users",
  {
    id: pk(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    passwordHash: text("password_hash"), // null for OAuth-only accounts
    name: text("name").notNull(),
    // Mirrors handles.slug. Nullable because account deletion (AU-15) nulls it and releases the handle.
    slug: text("slug"),
    avatarFileId: uuid("avatar_file_id").references((): AnyPgColumn => files.id, { onDelete: "set null" }),
    avatarUrl: text("avatar_url"), // provider avatar
    timezone: text("timezone").notNull().default("UTC"),
    locale: text("locale").notNull().default("en"),
    timeFormat: text("time_format").notNull().default("12h"), // '12h' | '24h'
    dateFormat: text("date_format").notNull().default("MM/DD/YYYY"), // 'MM/DD/YYYY' | 'DD/MM/YYYY'
    weekStart: smallint("week_start").notNull().default(0), // 0 Sunday, 1 Monday
    country: text("country"), // ISO 3166-1 alpha-2
    welcomeMessage: text("welcome_message").notNull().default(DEFAULT_WELCOME_MESSAGE),
    destinationCalendarId: uuid("destination_calendar_id").references((): AnyPgColumn => calendars.id, { onDelete: "set null" }),
    defaultLocation: jsonb("default_location").$type<LocationConfig | null>(),
    meetingLimitDay: integer("meeting_limit_day"),
    meetingLimitWeek: integer("meeting_limit_week"),
    meetingLimitMonth: integer("meeting_limit_month"),
    holidayCountry: text("holiday_country"), // AU, BR, CA, FR, DE, MX, NL, ES, GB, US
    logoFileId: uuid("logo_file_id").references((): AnyPgColumn => files.id, { onDelete: "set null" }),
    showBranding: boolean("show_branding").notNull().default(true),
    brandColors: jsonb("brand_colors").$type<BrandColors>().notNull().default({}),
    notificationPrefs: jsonb("notification_prefs")
      .$type<NotificationPrefs>()
      .notNull()
      .default(DEFAULT_NOTIFICATION_PREFS),
    bookingEmailVerificationDefault: boolean("booking_email_verification_default").notNull().default(false),
    ga4MeasurementId: text("ga4_measurement_id"),
    metaPixelId: text("meta_pixel_id"),
    phoneNumber: text("phone_number"), // E.164 (host SMS)
    phoneVerifiedAt: ts("phone_verified_at"),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    twoFactorSecretEnc: text("two_factor_secret_enc"),
    isInstanceAdmin: boolean("is_instance_admin").notNull().default(false),
    onboardingStep: text("onboarding_step"),
    onboardingCompletedAt: ts("onboarding_completed_at"),
    useCase: text("use_case"),
    usageMode: text("usage_mode"), // 'solo' | 'team'
    lastLoginAt: ts("last_login_at"),
    lastActiveAt: ts("last_active_at"),
    // TM-04 admin delete: the invitation this account was created from.
    createdViaInvitationId: uuid("created_via_invitation_id").references((): AnyPgColumn => organizationInvitations.id, {
      onDelete: "set null",
    }),
    preferences: jsonb("preferences").$type<UserPreferences>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.emailNormalized).where(sql`deleted_at is null`),
    uniqueIndex("users_slug_uq").on(t.slug).where(sql`deleted_at is null`),
    index("users_avatar_file_idx").on(t.avatarFileId),
    index("users_logo_file_idx").on(t.logoFileId),
    index("users_destination_calendar_idx").on(t.destinationCalendarId),
    index("users_created_via_invitation_idx").on(t.createdViaInvitationId),
  ],
);
// AU-15 deletion also nulls slug and calls releaseHandle(), so the handles row (primary key slug) is freed too.

export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    twoFactorPending: boolean("two_factor_pending").notNull().default(false),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    provider: oauthProvider("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    lastLoginAt: ts("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("oauth_provider_account_uq").on(t.provider, t.providerAccountId),
    index("oauth_user_idx").on(t.userId),
  ],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: pk(),
    userId: uuid("user_id").references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    purpose: authTokenPurpose("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    email: text("email"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash), index("auth_tokens_user_idx").on(t.userId, t.purpose)],
);

/** 6-digit codes (booking, poll vote, login method change, phone). */
export const verificationCodes = pgTable(
  "verification_codes",
  {
    id: pk(),
    purpose: verificationPurpose("purpose").notNull(),
    emailNormalized: text("email_normalized"),
    phone: text("phone"),
    // hashCode(): HMAC-SHA256(session_secret, purpose + ":" + contextId + ":" + code), never plain SHA-256
    codeHash: text("code_hash").notNull(),
    contextId: text("context_id"), // reservation, poll or user id
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("verification_lookup_idx").on(t.purpose, t.emailNormalized, t.createdAt)],
);

/** Booking "Remember this device". */
export const trustedDevices = pgTable(
  "trusted_devices",
  {
    id: pk(),
    emailNormalized: text("email_normalized").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("trusted_devices_token_uq").on(t.tokenHash)],
);

export const twoFactorRecoveryCodes = pgTable(
  "two_factor_recovery_codes",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("recovery_user_idx").on(t.userId)],
);

/** Keys: session_secret, encryption_key, cron_secret_generated. */
export const appSecrets = pgTable("app_secrets", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: createdAt(),
});

/**
 * Keys: signup_policy ("invite_only" | "open" | "domains"), signup_domains (string[]), operator ({ name, email }),
 * default_invitee_locale, last_cron_at, job_runner_lease ({ holder, until }).
 */
export const instanceSettings = pgTable("instance_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
  updatedByUserId: uuid("updated_by_user_id"),
});

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_limit_window_idx").on(t.windowStart)],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  avatarFile: one(files, {
    fields: [users.avatarFileId],
    references: [files.id],
    relationName: "users.avatar_file_id",
  }),
  logoFile: one(files, { fields: [users.logoFileId], references: [files.id], relationName: "users.logo_file_id" }),
  destinationCalendar: one(calendars, {
    fields: [users.destinationCalendarId],
    references: [calendars.id],
    relationName: "users.destination_calendar_id",
  }),
  createdViaInvitation: one(organizationInvitations, {
    fields: [users.createdViaInvitationId],
    references: [organizationInvitations.id],
    relationName: "users.created_via_invitation_id",
  }),
  sessions: many(sessions, { relationName: "sessions.user_id" }),
  oauthAccounts: many(oauthAccounts, { relationName: "oauth_accounts.user_id" }),
  authTokens: many(authTokens, { relationName: "auth_tokens.user_id" }),
  recoveryCodes: many(twoFactorRecoveryCodes, { relationName: "two_factor_recovery_codes.user_id" }),
  organizationMemberships: many(organizationMemberships, { relationName: "organization_memberships.user_id" }),
  sentInvitations: many(organizationInvitations, { relationName: "organization_invitations.invited_by_user_id" }),
  teamMemberships: many(teamMemberships, { relationName: "team_memberships.user_id" }),
  groupMemberships: many(groupMemberships, { relationName: "group_memberships.user_id" }),
  handle: one(handles),
  ownedFiles: many(files, { relationName: "files.owner_user_id" }),
  schedules: many(availabilitySchedules, { relationName: "availability_schedules.user_id" }),
  holidayOverrides: many(userHolidayOverrides, { relationName: "user_holiday_overrides.user_id" }),
  ownedEventTypes: many(eventTypes, { relationName: "event_types.owner_user_id" }),
  organizedEventTypes: many(eventTypes, { relationName: "event_types.organizer_user_id" }),
  eventTypeHosts: many(eventTypeHosts, { relationName: "event_type_hosts.user_id" }),
  eventTypePermissions: many(eventTypePermissions, { relationName: "event_type_permissions.user_id" }),
  managedEventAssignments: many(managedEventAssignments, { relationName: "managed_event_assignments.user_id" }),
  calendarConnections: many(calendarConnections, { relationName: "calendar_connections.user_id" }),
  calendars: many(calendars, { relationName: "calendars.user_id" }),
  calendarLinkedEvents: many(calendarLinkedEvents, { relationName: "calendar_linked_events.user_id" }),
  conferencingConnections: many(conferencingConnections, { relationName: "conferencing_connections.user_id" }),
  organizedScheduledEvents: many(scheduledEvents, { relationName: "scheduled_events.organizer_user_id" }),
  scheduledEventHosts: many(scheduledEventHosts, { relationName: "scheduled_event_hosts.user_id" }),
  blockedInvitees: many(blockedInvitees, { relationName: "blocked_invitees.user_id" }),
  singleUseLinks: many(singleUseLinks, { relationName: "single_use_links.owner_user_id" }),
  oneOffMeetings: many(oneOffMeetings, { relationName: "one_off_meetings.owner_user_id" }),
  availabilityShares: many(availabilityShares, { relationName: "availability_shares.user_id" }),
  meetingPolls: many(meetingPolls, { relationName: "meeting_polls.owner_user_id" }),
  pollParticipations: many(meetingPollParticipants, { relationName: "meeting_poll_participants.user_id" }),
  workflows: many(workflows, { relationName: "workflows.owner_user_id" }),
  routingForms: many(routingForms, { relationName: "routing_forms.owner_user_id" }),
  routingFormPermissions: many(routingFormPermissions, { relationName: "routing_form_permissions.user_id" }),
  contacts: many(contacts, { relationName: "contacts.owner_user_id" }),
  contactNotes: many(contactNotes, { relationName: "contact_notes.author_user_id" }),
  contactCustomFieldDefinitions: many(contactCustomFieldDefinitions, {
    relationName: "contact_custom_field_definitions.owner_user_id",
  }),
  contactLists: many(contactLists, { relationName: "contact_lists.owner_user_id" }),
  webhookSubscriptions: many(webhookSubscriptions, { relationName: "webhook_subscriptions.user_id" }),
  createdWebhookSubscriptions: many(webhookSubscriptions, { relationName: "webhook_subscriptions.creator_user_id" }),
  apiTokens: many(apiTokens, { relationName: "api_tokens.user_id" }),
  calendarFeed: one(calendarFeeds),
  coupons: many(coupons, { relationName: "coupons.owner_user_id" }),
  importRuns: many(importRuns, { relationName: "import_runs.user_id" }),
  importMappings: many(importMappings, { relationName: "import_mappings.user_id" }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id], relationName: "sessions.user_id" }),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one, many }) => ({
  user: one(users, { fields: [oauthAccounts.userId], references: [users.id], relationName: "oauth_accounts.user_id" }),
  calendarConnections: many(calendarConnections, { relationName: "calendar_connections.oauth_account_id" }),
}));

export const authTokensRelations = relations(authTokens, ({ one }) => ({
  user: one(users, { fields: [authTokens.userId], references: [users.id], relationName: "auth_tokens.user_id" }),
}));

export const twoFactorRecoveryCodesRelations = relations(twoFactorRecoveryCodes, ({ one }) => ({
  user: one(users, {
    fields: [twoFactorRecoveryCodes.userId],
    references: [users.id],
    relationName: "two_factor_recovery_codes.user_id",
  }),
}));
