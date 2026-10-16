// Friends link pages (/friends, lib/friends.ts). Server only. The link belongs to the instance owner (the owner of the
// oldest organization, which on this single-owner instance is the one account): /friends lists their event types,
// /friends/{eventSlug}[/{start}] books them through the same booking flow as /{handle}/{eventSlug}, in the friends tone.
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db";
import { handles, organizationMemberships, organizations, users } from "@/db/schema";
import { resolveTargetBySlugs } from "@/lib/booking";
import { parseStartParam } from "@/lib/url";
import { FRIENDS_PATH } from "../lib/friends";
import { loadBookingPage, type BookingPageResult } from "./booking-page";
import { loadLanding, type LandingData } from "./landing";

/** The handle the friends link books with: the instance owner's, or null before anyone signed up. */
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

export const loadFriendsLanding = cache(async (): Promise<LandingData | null> => {
  const handle = await friendsHandle();
  return handle ? loadLanding(handle) : null;
});

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment).trim().toLowerCase();
  } catch {
    return null;
  }
}

/** /friends/{eventSlug}[/{start}]: null (404) for unknown slugs, bad starts, or an instance without an owner. */
export const resolveFriendsPage = cache(
  async (eventSlugRaw: string, mode: "calendar" | "details", startRaw: string | null, query: string): Promise<BookingPageResult | null> => {
    const eventSlug = decode(eventSlugRaw);
    const handle = await friendsHandle();
    if (!eventSlug || !handle) return null;
    let start: Date | null = null;
    if (mode === "details") {
      start = startRaw ? parseStartParam(startRaw) : null;
      if (!start) return null;
    }
    const target = await resolveTargetBySlugs(handle, eventSlug);
    // Only the owner's own event types: secret types stay reachable by their real link only.
    if (!target || target.kind !== "event_type" || target.eventType.secret) return null;
    return loadBookingPage({
      target,
      basePath: `${FRIENDS_PATH}/${encodeURIComponent(target.eventType.slug)}`,
      landingPath: FRIENDS_PATH,
      searchParams: new URLSearchParams(query),
      mode,
      start,
      tone: "friends",
    });
  },
);
