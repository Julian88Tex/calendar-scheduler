// OWNER: teams-org. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Teams contract (ARCHITECTURE section 25): team lookups for the shell and landing pages, org members, and invitation
// acceptance used by the foundation-auth accept_invitation OAuth intent and /invite/[token]. Foundation implements
// minimal real queries; teams-org owns them afterwards (people management, teams settings, groups, managed events).
import "server-only";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import {
  eventTypes,
  organizationInvitations,
  organizationMemberships,
  organizations,
  teamMemberships,
  teams,
  users,
} from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { fileUrl } from "@/lib/files";
import { now } from "@/lib/time/now";

export type TeamRow = typeof teams.$inferSelect;
export type OrgRole = "owner" | "admin" | "user";

export type TeamSummary = { id: string; organizationId: string; name: string; slug: string; role: "manager" | "member" };

export type OrgMember = {
  userId: string;
  name: string | null;
  email: string | null;
  slug: string | null;
  avatarUrl: string | null;
  timezone: string;
  role: OrgRole;
};

export type TeamPublicProfile = {
  team: {
    id: string;
    organizationId: string;
    name: string;
    slug: string;
    welcomeMessage: string | null;
    avatarUrl: string | null;
    timezone: string;
  };
  /** Active, public (not secret) standard event types of the team, in position order (BK-02). */
  eventTypes: {
    id: string;
    name: string;
    slug: string;
    color: string;
    durationMinutes: number;
    durationOptions: number[] | null;
    descriptionPlain: string | null;
    kind: "solo" | "group";
    poolingType: "collective" | "round_robin" | "multi_pool" | null;
  }[];
};

export type PendingInvitation = {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  emailNormalized: string;
  role: Exclude<OrgRole, "owner">;
  teamIds: string[];
  invitedByName: string | null;
  expiresAt: Date;
};

const userAvatar = (u: { avatarFileId: string | null; avatarUrl: string | null }) =>
  u.avatarFileId ? fileUrl(u.avatarFileId) : (u.avatarUrl ?? null);

/** Teams the user belongs to (any role), by name. */
export async function listTeamsForUser(userId: string): Promise<TeamSummary[]> {
  const db = await getDb();
  return db
    .select({ id: teams.id, organizationId: teams.organizationId, name: teams.name, slug: teams.slug, role: teamMemberships.role })
    .from(teamMemberships)
    .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .where(and(eq(teamMemberships.userId, userId), isNull(teams.deletedAt)))
    .orderBy(asc(teams.name));
}

/** A live team by slug, or null. */
export async function getTeamBySlug(slug: string): Promise<TeamRow | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(teams)
    .where(and(eq(teams.slug, slug.toLowerCase()), isNull(teams.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** Live members of an organization with their role, by name. */
export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const db = await getDb();
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      slug: users.slug,
      avatarFileId: users.avatarFileId,
      avatarUrl: users.avatarUrl,
      timezone: users.timezone,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(and(eq(organizationMemberships.organizationId, orgId), isNull(users.deletedAt)))
    .orderBy(asc(users.name));
  return rows.map(({ avatarFileId, avatarUrl, ...r }) => ({ ...r, avatarUrl: userAvatar({ avatarFileId, avatarUrl }) }));
}

/** Team landing page data (BK-02), or null when no live team has the slug. */
export async function getTeamPublicProfile(slug: string): Promise<TeamPublicProfile | null> {
  const team = await getTeamBySlug(slug);
  if (!team) return null;
  const db = await getDb();
  const types = await db
    .select({
      id: eventTypes.id,
      name: eventTypes.name,
      slug: eventTypes.slug,
      color: eventTypes.color,
      durationMinutes: eventTypes.durationMinutes,
      durationOptions: eventTypes.durationOptions,
      descriptionPlain: eventTypes.descriptionPlain,
      kind: eventTypes.kind,
      poolingType: eventTypes.poolingType,
    })
    .from(eventTypes)
    .where(
      and(
        eq(eventTypes.teamId, team.id),
        eq(eventTypes.type, "standard"),
        eq(eventTypes.active, true),
        eq(eventTypes.secret, false),
        isNull(eventTypes.deletedAt),
      ),
    )
    .orderBy(asc(eventTypes.position), asc(eventTypes.createdAt));
  return {
    team: {
      id: team.id,
      organizationId: team.organizationId,
      name: team.name,
      slug: team.slug,
      welcomeMessage: team.welcomeMessage,
      avatarUrl: team.avatarFileId ? fileUrl(team.avatarFileId) : null,
      timezone: team.timezone,
    },
    eventTypes: types,
  };
}

/** A pending, unexpired invitation by its plaintext token (from /invite/{token}), or null. */
export async function getPendingInvitation(token: string): Promise<PendingInvitation | null> {
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({
      id: organizationInvitations.id,
      organizationId: organizationInvitations.organizationId,
      organizationName: organizations.name,
      email: organizationInvitations.email,
      emailNormalized: organizationInvitations.emailNormalized,
      role: organizationInvitations.role,
      teamIds: organizationInvitations.teamIds,
      invitedByName: users.name,
      expiresAt: organizationInvitations.expiresAt,
    })
    .from(organizationInvitations)
    .innerJoin(organizations, eq(organizations.id, organizationInvitations.organizationId))
    .leftJoin(users, eq(users.id, organizationInvitations.invitedByUserId))
    .where(
      and(
        eq(organizationInvitations.tokenHash, hashToken(token)),
        eq(organizationInvitations.status, "pending"),
        gt(organizationInvitations.expiresAt, now()),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, role: row.role === "admin" ? "admin" : "user", teamIds: row.teamIds ?? [] };
}

/**
 * Accepts an invitation for `userId` inside the caller's transaction: creates the organization membership with the
 * invited role (or keeps an existing membership in the same organization), adds the invited team memberships and marks
 * the invitation accepted. Throws AppError("not_found") when the invitation is no longer pending or has expired, and
 * AppError("conflict") when the user already belongs to another organization.
 */
export async function acceptInvitationInTx(tx: DbOrTx, p: { invitationId: string; userId: string }): Promise<void> {
  const [inv] = await tx
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.id, p.invitationId))
    .limit(1)
    .for("update");
  if (!inv || inv.status !== "pending" || inv.expiresAt.getTime() <= now().getTime()) {
    throw new AppError("not_found", "This invitation is no longer valid.");
  }
  const [membership] = await tx
    .select()
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, p.userId))
    .limit(1);
  if (membership && membership.organizationId !== inv.organizationId) {
    throw new AppError("conflict", "You already belong to another workspace.");
  }
  if (!membership) {
    await tx
      .insert(organizationMemberships)
      .values({ organizationId: inv.organizationId, userId: p.userId, role: inv.role === "admin" ? "admin" : "user" });
  }
  const teamIds = inv.teamIds ?? [];
  if (teamIds.length) {
    const live = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.organizationId, inv.organizationId), isNull(teams.deletedAt)));
    const allowed = new Set(live.map((t) => t.id));
    const rows = teamIds.filter((id) => allowed.has(id)).map((teamId) => ({ teamId, userId: p.userId, role: "member" as const }));
    if (rows.length) await tx.insert(teamMemberships).values(rows).onConflictDoNothing();
  }
  await tx
    .update(organizationInvitations)
    .set({ status: "accepted", acceptedUserId: p.userId })
    .where(eq(organizationInvitations.id, inv.id));
}
