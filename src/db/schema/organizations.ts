// ARCHITECTURE section 5.4.2: organizations, memberships, invitations, teams, groups and the shared handle namespace.
import { relations, sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_columns.ts";
import { users } from "./auth.ts";
import { files } from "./files.ts";
import { eventTypes, managedEventAssignments } from "./event-types.ts";
import { scheduledEvents } from "./bookings.ts";
import { meetingPolls } from "./polls.ts";
import { workflows } from "./workflows.ts";
import { routingForms } from "./routing.ts";
import { webhookSubscriptions } from "./developer.ts";
import { dataDeletionRequests } from "./admin.ts";

export const orgRole = pgEnum("org_role", ["owner", "admin", "user"]);
export const teamRole = pgEnum("team_role", ["manager", "member"]);
export const groupRole = pgEnum("group_role", ["admin", "member"]);
export const invitationStatus = pgEnum("invitation_status", ["pending", "accepted", "declined", "revoked", "expired"]);

export type OrgSettings = {
  sharedEventTypeCreators: "everyone" | "admins";
  invitePermission: "admins" | "admins_and_group_admins";
  defaultEmailVerification: boolean;
};

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  sharedEventTypeCreators: "everyone",
  invitePermission: "admins",
  defaultEmailVerification: false,
};

export const organizations = pgTable(
  "organizations",
  {
    id: pk(),
    name: text("name").notNull(),
    logoFileId: uuid("logo_file_id").references((): AnyPgColumn => files.id, { onDelete: "set null" }),
    applyBrandingToMembers: boolean("apply_branding_to_members").notNull().default(false),
    showBranding: boolean("show_branding").notNull().default(true),
    settings: jsonb("settings").$type<OrgSettings>().notNull().default(DEFAULT_ORG_SETTINGS),
    plan: text("plan").notNull().default("self_hosted"), // API parity
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("organizations_logo_file_idx").on(t.logoFileId)],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: pk(),
    organizationId: uuid("organization_id")
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull().default("user"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_membership_user_uq").on(t.userId),
    index("org_membership_org_idx").on(t.organizationId, t.role),
    uniqueIndex("org_single_owner_uq").on(t.organizationId).where(sql`role = 'owner'`),
  ],
);

export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: pk(),
    organizationId: uuid("organization_id")
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    role: orgRole("role").notNull().default("user"),
    teamIds: uuid("team_ids").array().notNull().default([]),
    tokenHash: text("token_hash").notNull(),
    status: invitationStatus("status").notNull().default("pending"),
    invitedByUserId: uuid("invited_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    acceptedUserId: uuid("accepted_user_id"),
    lastSentAt: ts("last_sent_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_invitation_token_uq").on(t.tokenHash),
    uniqueIndex("org_invitation_pending_uq").on(t.organizationId, t.emailNormalized).where(sql`status = 'pending'`),
    index("org_invitation_org_idx").on(t.organizationId, t.status),
    index("org_invitation_inviter_idx").on(t.invitedByUserId),
    check("org_invitations_role_ck", sql`role <> 'owner'`),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: pk(),
    organizationId: uuid("organization_id")
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(), // mirrors handles.slug
    welcomeMessage: text("welcome_message"),
    avatarFileId: uuid("avatar_file_id").references((): AnyPgColumn => files.id, { onDelete: "set null" }),
    timezone: text("timezone").notNull().default("UTC"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("teams_slug_uq").on(t.slug).where(sql`deleted_at is null`),
    index("teams_org_idx").on(t.organizationId),
    index("teams_avatar_file_idx").on(t.avatarFileId),
  ],
);

export const teamMemberships = pgTable(
  "team_memberships",
  {
    teamId: uuid("team_id")
      .notNull()
      .references((): AnyPgColumn => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    role: teamRole("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] }), index("team_memberships_user_idx").on(t.userId)],
);

export const groups = pgTable(
  "groups",
  {
    id: pk(),
    organizationId: uuid("organization_id")
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("groups_org_idx").on(t.organizationId)],
);

export const groupMemberships = pgTable(
  "group_memberships",
  {
    groupId: uuid("group_id")
      .notNull()
      .references((): AnyPgColumn => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    role: groupRole("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId, t.role] }), index("group_memberships_user_idx").on(t.userId)],
);

/** Shared namespace for user and team slugs (exactly one owner per row). */
export const handles = pgTable(
  "handles",
  {
    slug: text("slug").primaryKey(),
    userId: uuid("user_id").references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references((): AnyPgColumn => teams.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("handles_user_uq").on(t.userId),
    uniqueIndex("handles_team_uq").on(t.teamId),
    check("handles_one_owner", sql`num_nonnulls(user_id, team_id) = 1`),
  ],
);

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  logoFile: one(files, {
    fields: [organizations.logoFileId],
    references: [files.id],
    relationName: "organizations.logo_file_id",
  }),
  memberships: many(organizationMemberships, { relationName: "organization_memberships.organization_id" }),
  invitations: many(organizationInvitations, { relationName: "organization_invitations.organization_id" }),
  teams: many(teams, { relationName: "teams.organization_id" }),
  groups: many(groups, { relationName: "groups.organization_id" }),
  eventTypes: many(eventTypes, { relationName: "event_types.organization_id" }),
  scheduledEvents: many(scheduledEvents, { relationName: "scheduled_events.organization_id" }),
  meetingPolls: many(meetingPolls, { relationName: "meeting_polls.organization_id" }),
  workflows: many(workflows, { relationName: "workflows.organization_id" }),
  routingForms: many(routingForms, { relationName: "routing_forms.organization_id" }),
  webhookSubscriptions: many(webhookSubscriptions, { relationName: "webhook_subscriptions.organization_id" }),
  dataDeletionRequests: many(dataDeletionRequests, { relationName: "data_deletion_requests.organization_id" }),
}));

export const organizationMembershipsRelations = relations(organizationMemberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMemberships.organizationId],
    references: [organizations.id],
    relationName: "organization_memberships.organization_id",
  }),
  user: one(users, {
    fields: [organizationMemberships.userId],
    references: [users.id],
    relationName: "organization_memberships.user_id",
  }),
}));

export const organizationInvitationsRelations = relations(organizationInvitations, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [organizationInvitations.organizationId],
    references: [organizations.id],
    relationName: "organization_invitations.organization_id",
  }),
  invitedBy: one(users, {
    fields: [organizationInvitations.invitedByUserId],
    references: [users.id],
    relationName: "organization_invitations.invited_by_user_id",
  }),
  createdUsers: many(users, { relationName: "users.created_via_invitation_id" }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [teams.organizationId],
    references: [organizations.id],
    relationName: "teams.organization_id",
  }),
  avatarFile: one(files, { fields: [teams.avatarFileId], references: [files.id], relationName: "teams.avatar_file_id" }),
  memberships: many(teamMemberships, { relationName: "team_memberships.team_id" }),
  handle: one(handles),
  eventTypes: many(eventTypes, { relationName: "event_types.team_id" }),
  managedEventAssignments: many(managedEventAssignments, { relationName: "managed_event_assignments.team_id" }),
  workflows: many(workflows, { relationName: "workflows.team_id" }),
}));

export const teamMembershipsRelations = relations(teamMemberships, ({ one }) => ({
  team: one(teams, { fields: [teamMemberships.teamId], references: [teams.id], relationName: "team_memberships.team_id" }),
  user: one(users, { fields: [teamMemberships.userId], references: [users.id], relationName: "team_memberships.user_id" }),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [groups.organizationId],
    references: [organizations.id],
    relationName: "groups.organization_id",
  }),
  memberships: many(groupMemberships, { relationName: "group_memberships.group_id" }),
  webhookSubscriptions: many(webhookSubscriptions, { relationName: "webhook_subscriptions.group_id" }),
}));

export const groupMembershipsRelations = relations(groupMemberships, ({ one }) => ({
  group: one(groups, {
    fields: [groupMemberships.groupId],
    references: [groups.id],
    relationName: "group_memberships.group_id",
  }),
  user: one(users, {
    fields: [groupMemberships.userId],
    references: [users.id],
    relationName: "group_memberships.user_id",
  }),
}));

export const handlesRelations = relations(handles, ({ one }) => ({
  user: one(users, { fields: [handles.userId], references: [users.id], relationName: "handles.user_id" }),
  team: one(teams, { fields: [handles.teamId], references: [teams.id], relationName: "handles.team_id" }),
}));
