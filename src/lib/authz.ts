// Authorization (ARCHITECTURE section 18.7; SPEC GEN-08, TM-01, ET-31, MP-01).
//
// Every Server Action and route handler calls getActorCtx() (or receives the actor from runAction) and an access helper
// below; the proxy is never trusted. Rules:
// - Org owners and admins: everything in their organization. Nothing crosses organizations: every helper returns null
//   for another org's rows. Instance admins see admin pages but not other orgs' meetings unless also org admins.
// - Event types: personal owner -> "owner"; hosts of shared, team and adhoc (one-off, poll) types -> "edit"; team
//   managers -> "edit" on their team's types, team members -> "view"; event_type_permissions grant view or edit;
//   org admins -> "edit".
// - Meetings: hosts and the organizer manage; event type editors manage; viewers view; org admins manage.
// - Teams: org admins and team managers manage; members are "member". Routing forms: owner, org admins and
//   routing_form_permissions. Polls: creator "owner"; co-hosts (the poll's adhoc event type hosts) and org admins
//   "manage".
//
// Cross-tenant reference checks (GEN-08): foreign keys do not prove ownership. Every write that stores another
// record's id calls the matching assert* helper inside its write transaction; each throws AppError("forbidden") unless
// the referenced row belongs to the expected owner or organization (and is live).
import "server-only";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { cache } from "react";
import { getDb, type DbOrTx } from "@/db";
import {
  availabilitySchedules,
  calendarConnections,
  calendars,
  conferencingConnections,
  contacts,
  coupons,
  eventTypeHosts,
  eventTypePermissions,
  eventTypes,
  groupMemberships,
  groups,
  meetingPolls,
  organizationMemberships,
  routingFormPermissions,
  routingForms,
  scheduledEventHosts,
  scheduledEvents,
  teamMemberships,
  teams,
  users,
} from "@/db/schema";
import type { LocationConfig } from "@/db/types";
import { requireUser, type UserRow } from "./auth/session";
import { adminEmails } from "./env";
import { AppError } from "./errors";
import { isUuid } from "./ids";

export type OrgRole = "owner" | "admin" | "user";
export type TeamRole = "manager" | "member";

export type ActorCtx = {
  user: UserRow;
  orgId: string;
  orgRole: OrgRole;
  isInstanceAdmin: boolean;
  teamRoles: Map<string, TeamRole>;
  groupAdminOf: Set<string>;
};

export type EventTypeAccess = "owner" | "edit" | "view";
export type MeetingAccess = "manage" | "view";
export type TeamAccess = "manage" | "member";
export type RoutingFormAccess = "edit" | "view";
export type PollAccess = "manage" | "owner";

const FORBIDDEN_REFERENCE = "You don't have access to one of the selected items.";
const forbidden = (message = FORBIDDEN_REFERENCE) => new AppError("forbidden", message);

/**
 * True for instance admins: users.is_instance_admin (the first user) or an ADMIN_EMAILS address. The ADMIN_EMAILS
 * grant requires a verified email (email_verified_at set; OAuth sign-ins verify it), otherwise anyone could sign up
 * with a listed address under the open signup policy and gain instance admin rights before proving ownership.
 */
export function isInstanceAdminUser(
  user: Pick<UserRow, "isInstanceAdmin" | "emailNormalized"> & { emailVerifiedAt?: Date | null },
): boolean {
  if (user.isInstanceAdmin) return true;
  const email = user.emailNormalized?.toLowerCase();
  return Boolean(email && user.emailVerifiedAt && adminEmails().includes(email));
}

/** Builds the actor context of a user (exported for jobs, tests and API token auth). */
export async function loadActorCtx(db: DbOrTx, user: UserRow): Promise<ActorCtx> {
  const [membership] = await db
    .select({ orgId: organizationMemberships.organizationId, role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, user.id))
    .limit(1);
  if (!membership) throw new AppError("forbidden", "Your account is not part of an organization.");
  const teamRows = await db
    .select({ teamId: teamMemberships.teamId, role: teamMemberships.role })
    .from(teamMemberships)
    .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .where(
      and(
        eq(teamMemberships.userId, user.id),
        eq(teams.organizationId, membership.orgId),
        isNull(teams.deletedAt),
      ),
    );
  const groupRows = await db
    .select({ groupId: groupMemberships.groupId })
    .from(groupMemberships)
    .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
    .where(
      and(
        eq(groupMemberships.userId, user.id),
        eq(groupMemberships.role, "admin"),
        eq(groups.organizationId, membership.orgId),
      ),
    );
  return {
    user,
    orgId: membership.orgId,
    orgRole: membership.role,
    isInstanceAdmin: isInstanceAdminUser(user),
    teamRoles: new Map(teamRows.map((r) => [r.teamId, r.role])),
    groupAdminOf: new Set(groupRows.map((r) => r.groupId)),
  };
}

/**
 * The signed-in actor, cached per request. Redirects to login when signed out (Server Components and actions); use
 * getApiActorCtx() in route handlers to get AppError(401) instead.
 */
export const getActorCtx = cache(async (): Promise<ActorCtx> => {
  const user = await requireUser();
  return loadActorCtx(await getDb(), user);
});

/** getActorCtx() for route handlers: throws AppError("unauthorized") instead of redirecting. */
export const getApiActorCtx = cache(async (): Promise<ActorCtx> => {
  const user = await requireUser({ onMissing: "throw" });
  return loadActorCtx(await getDb(), user);
});

/** Org owner or admin. */
export function isOrgAdmin(a: ActorCtx): boolean {
  return a.orgRole === "owner" || a.orgRole === "admin";
}

/** Org owner. */
export function isOrgOwner(a: ActorCtx): boolean {
  return a.orgRole === "owner";
}

/** Admin center access (GEN-20: owners, admins and instance admins). */
export function canSeeAdminCenter(a: ActorCtx): boolean {
  return isOrgAdmin(a) || a.isInstanceAdmin;
}

const EVENT_TYPE_RANK: Record<EventTypeAccess, number> = { view: 1, edit: 2, owner: 3 };

function maxEventTypeAccess(levels: (EventTypeAccess | null | undefined)[]): EventTypeAccess | null {
  let best: EventTypeAccess | null = null;
  for (const l of levels) if (l && (!best || EVENT_TYPE_RANK[l] > EVENT_TYPE_RANK[best])) best = l;
  return best;
}

/** True when `level` grants at least `required` (view < edit < owner). */
export function eventTypeAccessAtLeast(level: EventTypeAccess | null, required: EventTypeAccess): boolean {
  return level !== null && EVENT_TYPE_RANK[level] >= EVENT_TYPE_RANK[required];
}

/** The actor's access to an event type (see the file header), or null. */
export async function eventTypeAccess(a: ActorCtx, eventTypeId: string, db?: DbOrTx): Promise<EventTypeAccess | null> {
  if (!isUuid(eventTypeId)) return null;
  const d = db ?? (await getDb());
  const [row] = await d
    .select({
      organizationId: eventTypes.organizationId,
      ownerUserId: eventTypes.ownerUserId,
      teamId: eventTypes.teamId,
      scope: eventTypes.scope,
      type: eventTypes.type,
      deletedAt: eventTypes.deletedAt,
      // Subqueries compare with the id parameter, never with an outer column: in single-table selects drizzle renders
      // columns unqualified, so an outer column reference would bind to the subquery's own table.
      isHost: sql<boolean>`exists (select 1 from ${eventTypeHosts} where ${eventTypeHosts.eventTypeId} = ${eventTypeId} and ${eventTypeHosts.userId} = ${a.user.id})`,
      permission: sql<"view" | "edit" | null>`(select ${eventTypePermissions.level} from ${eventTypePermissions} where ${eventTypePermissions.eventTypeId} = ${eventTypeId} and ${eventTypePermissions.userId} = ${a.user.id} limit 1)`,
    })
    .from(eventTypes)
    .where(eq(eventTypes.id, eventTypeId))
    .limit(1);
  if (!row || row.deletedAt || row.organizationId !== a.orgId) return null;
  const teamRole = row.teamId ? a.teamRoles.get(row.teamId) : undefined;
  return maxEventTypeAccess([
    row.ownerUserId === a.user.id && row.scope !== "team" ? "owner" : null,
    isOrgAdmin(a) ? "edit" : null,
    row.isHost ? (row.scope !== "personal" || row.type === "adhoc" ? "edit" : "view") : null,
    teamRole === "manager" ? "edit" : teamRole === "member" ? "view" : null,
    row.permission,
  ]);
}

/** The actor's access to a scheduled event (meeting), or null. */
export async function meetingAccess(a: ActorCtx, scheduledEventId: string, db?: DbOrTx): Promise<MeetingAccess | null> {
  if (!isUuid(scheduledEventId)) return null;
  const d = db ?? (await getDb());
  const [row] = await d
    .select({
      organizationId: scheduledEvents.organizationId,
      eventTypeId: scheduledEvents.eventTypeId,
      organizerUserId: scheduledEvents.organizerUserId,
      isHost: sql<boolean>`exists (select 1 from ${scheduledEventHosts} where ${scheduledEventHosts.scheduledEventId} = ${scheduledEventId} and ${scheduledEventHosts.userId} = ${a.user.id})`,
    })
    .from(scheduledEvents)
    .where(eq(scheduledEvents.id, scheduledEventId))
    .limit(1);
  if (!row || row.organizationId !== a.orgId) return null;
  if (row.organizerUserId === a.user.id || row.isHost || isOrgAdmin(a)) return "manage";
  const et = row.eventTypeId ? await eventTypeAccess(a, row.eventTypeId, d) : null;
  if (et === "owner" || et === "edit") return "manage";
  if (et === "view") return "view";
  return null;
}

/** The actor's access to a team, or null. */
export async function teamAccess(a: ActorCtx, teamId: string, db?: DbOrTx): Promise<TeamAccess | null> {
  if (!isUuid(teamId)) return null;
  const d = db ?? (await getDb());
  const [row] = await d
    .select({ organizationId: teams.organizationId, deletedAt: teams.deletedAt })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!row || row.deletedAt || row.organizationId !== a.orgId) return null;
  if (isOrgAdmin(a)) return "manage";
  const role = a.teamRoles.get(teamId);
  if (role === "manager") return "manage";
  if (role === "member") return "member";
  return null;
}

/** The actor's access to a routing form, or null. */
export async function routingFormAccess(a: ActorCtx, formId: string, db?: DbOrTx): Promise<RoutingFormAccess | null> {
  if (!isUuid(formId)) return null;
  const d = db ?? (await getDb());
  const [row] = await d
    .select({
      organizationId: routingForms.organizationId,
      ownerUserId: routingForms.ownerUserId,
      deletedAt: routingForms.deletedAt,
      permission: sql<"view" | "edit" | null>`(select ${routingFormPermissions.level} from ${routingFormPermissions} where ${routingFormPermissions.formId} = ${formId} and ${routingFormPermissions.userId} = ${a.user.id} limit 1)`,
    })
    .from(routingForms)
    .where(eq(routingForms.id, formId))
    .limit(1);
  if (!row || row.deletedAt || row.organizationId !== a.orgId) return null;
  if (row.ownerUserId === a.user.id || isOrgAdmin(a)) return "edit";
  return row.permission ?? null;
}

/** The actor's access to a meeting poll: creator "owner", co-hosts and org admins "manage" (MP-01), else null. */
export async function pollAccess(a: ActorCtx, pollId: string, db?: DbOrTx): Promise<PollAccess | null> {
  if (!isUuid(pollId)) return null;
  const d = db ?? (await getDb());
  const [row] = await d
    .select({
      organizationId: meetingPolls.organizationId,
      ownerUserId: meetingPolls.ownerUserId,
      deletedAt: meetingPolls.deletedAt,
      eventTypeId: meetingPolls.eventTypeId,
    })
    .from(meetingPolls)
    .where(eq(meetingPolls.id, pollId))
    .limit(1);
  if (!row || row.deletedAt || row.organizationId !== a.orgId) return null;
  if (row.ownerUserId === a.user.id) return "owner";
  if (isOrgAdmin(a)) return "manage";
  if (!row.eventTypeId) return null;
  const [host] = await d
    .select({ id: eventTypeHosts.id })
    .from(eventTypeHosts)
    .where(and(eq(eventTypeHosts.eventTypeId, row.eventTypeId), eq(eventTypeHosts.userId, a.user.id)))
    .limit(1);
  return host ? "manage" : null;
}

/** Throws AppError("forbidden") unless `value` is truthy (an access level). */
export function assertAccess<T>(value: T | null | false | undefined, message?: string): asserts value {
  if (!value) throw new AppError("forbidden", message);
}

// ---------------------------------------------------------------------------------------------------------------
// Cross-tenant reference checks (call inside the write transaction).

function assertIds(ids: string[]): void {
  for (const id of ids) if (!isUuid(id)) throw forbidden();
}

/**
 * The schedule must be live and either owned by one of `userIds` (and not another event type's or link's custom
 * schedule), or a custom schedule of `opts.eventTypeId` / `opts.singleUseLinkId` (availability_schedules.event_type_id
 * and single_use_link_id).
 */
export async function assertScheduleUsableBy(
  tx: DbOrTx,
  scheduleId: string,
  userIds: string[],
  opts: { eventTypeId?: string | null; singleUseLinkId?: string | null } = {},
): Promise<void> {
  assertIds([scheduleId]);
  const [row] = await tx
    .select({
      userId: availabilitySchedules.userId,
      eventTypeId: availabilitySchedules.eventTypeId,
      singleUseLinkId: availabilitySchedules.singleUseLinkId,
      deletedAt: availabilitySchedules.deletedAt,
    })
    .from(availabilitySchedules)
    .where(eq(availabilitySchedules.id, scheduleId))
    .limit(1);
  if (!row || row.deletedAt) throw forbidden();
  if (opts.eventTypeId && row.eventTypeId === opts.eventTypeId) return;
  if (opts.singleUseLinkId && row.singleUseLinkId === opts.singleUseLinkId) return;
  if (!userIds.includes(row.userId)) throw forbidden();
  if (row.eventTypeId && row.eventTypeId !== opts.eventTypeId) throw forbidden();
  if (row.singleUseLinkId && row.singleUseLinkId !== opts.singleUseLinkId) throw forbidden();
}

/** Every user must be a live member of the organization (hosts, co-hosts, organizers, busy lookups). */
export async function assertSameOrgUsers(tx: DbOrTx, orgId: string, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  assertIds([orgId, ...ids]);
  const rows = await tx
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(
      and(
        eq(organizationMemberships.organizationId, orgId),
        inArray(organizationMemberships.userId, ids),
        isNull(users.deletedAt),
      ),
    );
  if (rows.length !== ids.length) throw forbidden();
}

/**
 * The calendar must belong to the user through a live connection. As a destination (the default) it must also be
 * writable; pass { purpose: "read" } for conflict-check selections.
 */
export async function assertCalendarOwnedBy(
  tx: DbOrTx,
  calendarId: string,
  userId: string,
  opts: { purpose?: "destination" | "read" } = {},
): Promise<void> {
  assertIds([calendarId, userId]);
  const [row] = await tx
    .select({
      userId: calendars.userId,
      canWrite: calendars.canWrite,
      deletedAt: calendars.deletedAt,
      connectionUserId: calendarConnections.userId,
      status: calendarConnections.status,
    })
    .from(calendars)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .where(eq(calendars.id, calendarId))
    .limit(1);
  if (!row || row.deletedAt || row.userId !== userId || row.connectionUserId !== userId) throw forbidden();
  if (row.status === "disconnected") throw forbidden();
  if ((opts.purpose ?? "destination") === "destination" && !row.canWrite) {
    throw new AppError("forbidden", "Choose a calendar you can add events to.");
  }
}

/** The conferencing connection (Zoom, ...) must belong to the user and not be disconnected. */
export async function assertConferencingConnectionOwnedBy(tx: DbOrTx, connectionId: string, userId: string): Promise<void> {
  assertIds([connectionId, userId]);
  const [row] = await tx
    .select({ id: conferencingConnections.id })
    .from(conferencingConnections)
    .where(
      and(
        eq(conferencingConnections.id, connectionId),
        eq(conferencingConnections.userId, userId),
        ne(conferencingConnections.status, "disconnected"),
      ),
    )
    .limit(1);
  if (!row) throw forbidden();
}

/** Every LocationConfig.connectionId must be a conferencing connection of one of `userIds` (event type hosts). */
export async function assertLocationConnectionsOwnedBy(
  tx: DbOrTx,
  locations: (Pick<LocationConfig, "connectionId"> | null | undefined)[],
  userIds: string[],
): Promise<void> {
  const connectionIds = [...new Set(locations.map((l) => l?.connectionId).filter((v): v is string => Boolean(v)))];
  if (!connectionIds.length) return;
  assertIds(connectionIds);
  if (!userIds.length) throw forbidden();
  assertIds(userIds);
  const rows = await tx
    .select({ id: conferencingConnections.id })
    .from(conferencingConnections)
    .where(
      and(
        inArray(conferencingConnections.id, connectionIds),
        inArray(conferencingConnections.userId, userIds),
        ne(conferencingConnections.status, "disconnected"),
      ),
    );
  if (rows.length !== connectionIds.length) throw forbidden();
}

/** The contact must belong to the user and not be deleted. */
export async function assertContactOwnedBy(tx: DbOrTx, contactId: string, userId: string): Promise<void> {
  assertIds([contactId, userId]);
  const [row] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.ownerUserId, userId), isNull(contacts.deletedAt)))
    .limit(1);
  if (!row) throw forbidden();
}

/** The coupon must belong to the user and not be deleted. */
export async function assertCouponOwnedBy(tx: DbOrTx, couponId: string, userId: string): Promise<void> {
  assertIds([couponId, userId]);
  const [row] = await tx
    .select({ id: coupons.id })
    .from(coupons)
    .where(and(eq(coupons.id, couponId), eq(coupons.ownerUserId, userId), isNull(coupons.deletedAt)))
    .limit(1);
  if (!row) throw forbidden();
}

/** The group must belong to the organization. */
export async function assertGroupInOrg(tx: DbOrTx, groupId: string, orgId: string): Promise<void> {
  assertIds([groupId, orgId]);
  const [row] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.organizationId, orgId)))
    .limit(1);
  if (!row) throw forbidden();
}

/** The team must be a live team of the organization. */
export async function assertTeamInOrg(tx: DbOrTx, teamId: string, orgId: string): Promise<void> {
  assertIds([teamId, orgId]);
  const [row] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.organizationId, orgId), isNull(teams.deletedAt)))
    .limit(1);
  if (!row) throw forbidden();
}

/** Every event type must be one the actor can edit (owner or edit access), for example workflow_event_types. */
export async function assertEventTypesEditable(tx: DbOrTx, a: ActorCtx, eventTypeIds: string[]): Promise<void> {
  const ids = [...new Set(eventTypeIds)];
  assertIds(ids);
  for (const id of ids) {
    const access = await eventTypeAccess(a, id, tx);
    if (access !== "owner" && access !== "edit") throw forbidden();
  }
}
