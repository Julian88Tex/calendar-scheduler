// Organizations, users (with handle and org membership), teams and groups.
import type { DbOrTx } from "@/db";
import {
  groupMemberships,
  groups,
  handles,
  organizationInvitations,
  organizationMemberships,
  organizations,
  teamMemberships,
  teams,
  users,
} from "@/db/schema";
import { addMinutes, normalizeEmail, one, sha256Hex, uniq } from "./_util";

export type OrganizationRow = typeof organizations.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;
export type OrgRole = "owner" | "admin" | "user";
/** A user row plus its organization and role (every user belongs to exactly one org). */
export type TestUser = UserRow & { organizationId: string; orgRole: OrgRole };

export async function createOrg(
  db: DbOrTx,
  overrides: Partial<typeof organizations.$inferInsert> = {},
): Promise<OrganizationRow> {
  return one(
    await db
      .insert(organizations)
      .values({ name: overrides.name ?? `Org ${uniq("")}`, ...overrides })
      .returning(),
    "organization",
  );
}

export type CreateUserOptions = {
  email?: string;
  name?: string;
  slug?: string;
  timezone?: string;
  /** Join an existing organization (default: a new organization owned by this user). */
  organizationId?: string;
  /** Role in the organization (default owner for a new org, user when joining). */
  orgRole?: OrgRole;
  passwordHash?: string | null;
  isInstanceAdmin?: boolean;
  /** Skip the handles row (default false). */
  withoutHandle?: boolean;
  overrides?: Partial<typeof users.$inferInsert>;
};

export async function createUser(db: DbOrTx, opts: CreateUserOptions = {}): Promise<TestUser> {
  const token = uniq("u");
  const email = opts.email ?? `${token}@example.com`;
  const slug = opts.slug ?? token;
  const name = opts.name ?? `User ${token}`;
  const user = one(
    await db
      .insert(users)
      .values({
        email,
        emailNormalized: normalizeEmail(email),
        name,
        slug,
        timezone: opts.timezone ?? "America/New_York",
        passwordHash: opts.passwordHash ?? null,
        isInstanceAdmin: opts.isInstanceAdmin ?? false,
        emailVerifiedAt: new Date(),
        ...opts.overrides,
      })
      .returning(),
    "user",
  );
  if (!opts.withoutHandle && user.slug) await db.insert(handles).values({ slug: user.slug, userId: user.id });
  const organizationId = opts.organizationId ?? (await createOrg(db, { name: `${name}'s Organization` })).id;
  const orgRole: OrgRole = opts.orgRole ?? (opts.organizationId ? "user" : "owner");
  await db.insert(organizationMemberships).values({ organizationId, userId: user.id, role: orgRole });
  return { ...user, organizationId, orgRole };
}

export type CreateTeamOptions = {
  organizationId: string;
  name?: string;
  slug?: string;
  members?: { userId: string; role?: "manager" | "member" }[];
  overrides?: Partial<typeof teams.$inferInsert>;
};

export async function createTeam(db: DbOrTx, opts: CreateTeamOptions) {
  const slug = opts.slug ?? uniq("team");
  const team = one(
    await db
      .insert(teams)
      .values({ organizationId: opts.organizationId, name: opts.name ?? `Team ${slug}`, slug, ...opts.overrides })
      .returning(),
    "team",
  );
  await db.insert(handles).values({ slug: team.slug, teamId: team.id });
  const memberships = opts.members?.length
    ? await db
        .insert(teamMemberships)
        .values(opts.members.map((m) => ({ teamId: team.id, userId: m.userId, role: m.role ?? "member" })))
        .returning()
    : [];
  return { team, memberships };
}

export async function createGroup(
  db: DbOrTx,
  opts: { organizationId: string; name?: string; members?: { userId: string; role?: "admin" | "member" }[] },
) {
  const group = one(
    await db
      .insert(groups)
      .values({ organizationId: opts.organizationId, name: opts.name ?? `Group ${uniq("")}` })
      .returning(),
    "group",
  );
  const memberships = opts.members?.length
    ? await db
        .insert(groupMemberships)
        .values(opts.members.map((m) => ({ groupId: group.id, userId: m.userId, role: m.role ?? "member" })))
        .returning()
    : [];
  return { group, memberships };
}

/** A pending invitation; returns the plaintext token for /invite/{token}. */
export async function createInvitation(
  db: DbOrTx,
  opts: {
    organizationId: string;
    email?: string;
    role?: "admin" | "user";
    teamIds?: string[];
    invitedByUserId?: string | null;
    expiresAt?: Date;
  },
) {
  const email = opts.email ?? `${uniq("inv")}@example.com`;
  const token = uniq("tok") + uniq("");
  const invitation = one(
    await db
      .insert(organizationInvitations)
      .values({
        organizationId: opts.organizationId,
        email,
        emailNormalized: normalizeEmail(email),
        role: opts.role ?? "user",
        teamIds: opts.teamIds ?? [],
        tokenHash: sha256Hex(token),
        invitedByUserId: opts.invitedByUserId ?? null,
        expiresAt: opts.expiresAt ?? addMinutes(new Date(), 7 * 24 * 60),
      })
      .returning(),
    "invitation",
  );
  return { invitation, token };
}
