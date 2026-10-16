// Friends mode (lib/friends.ts). Server only. The old friends link (/friends) belongs to the instance owner (the owner
// of the oldest organization, which on this single-owner instance is the one account); its paths redirect to the
// owner's public pages with ?friends=1.
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db";
import { handles, organizationMemberships, organizations, users } from "@/db/schema";
import { DEFAULT_FRIENDS_CONTENT, friendsContentOf, type FriendsContent } from "../lib/friends-content";

/** The handle the old friends link books with: the instance owner's, or null before anyone signed up. */
export const friendsHandle = cache(async (): Promise<string | null> => {
  const db = await getDb();
  const [row] = await db
    .select({ slug: handles.slug })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .innerJoin(handles, eq(handles.userId, users.id))
    .where(and(eq(organizationMemberships.role, "owner"), isNull(organizations.deletedAt), isNull(users.deletedAt)))
    .orderBy(asc(organizations.createdAt))
    .limit(1);
  return row?.slug ?? null;
});

/** The query of an old friends link request with friends=1 added (the rest kept, so month, date and back survive). */
export function friendsQuery(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === "string" && k !== "friends") q.append(k, value);
  }
  q.set("friends", "1");
  return q.toString();
}

/** The host's friends mode content (Settings > Friends mode) over the defaults; the defaults for unknown users. */
export const loadFriendsContent = cache(async (userId: string | null | undefined): Promise<FriendsContent> => {
  if (!userId) return DEFAULT_FRIENDS_CONTENT;
  const db = await getDb();
  const [row] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId)).limit(1);
  return friendsContentOf(row?.preferences?.friends);
});
