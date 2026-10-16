// Settings > Friends mode (lib/friends.ts in the booking components): the words, favorites and friendly event names of
// the ?friends=1 pages, stored in users.preferences.friends. Server only.
import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbOrTx } from "@/db";
import { eventTypes, users } from "@/db/schema";
import { FRIENDS_LIMITS, friendsContentOf, type FriendsContent } from "@/components/booking/lib/friends";
import { AppError } from "@/lib/errors";
import { now } from "@/lib/time/now";

const short = z.string().trim().max(FRIENDS_LIMITS.short * 2);

export const FriendsSettingsInput = z.object({
  greeting: short,
  note: z.string().trim().max(FRIENDS_LIMITS.long),
  signOff: short,
  favoritesHeading: short,
  favorites: z.array(z.object({ emoji: z.string().trim().max(FRIENDS_LIMITS.emoji), label: z.string().trim().max(FRIENDS_LIMITS.short) })).max(FRIENDS_LIMITS.favorites),
  chooseHeading: short,
  detailsIntro: short,
  confirmationNote: short,
  events: z.record(z.string().max(100), z.object({ name: z.string().trim().max(FRIENDS_LIMITS.short), blurb: short })),
});
export type FriendsSettingsValues = z.infer<typeof FriendsSettingsInput>;

/** Saves the friends mode content (empty text falls back to the default when shown) and returns what pages will show. */
export async function saveFriendsSettings(db: DbOrTx, userId: string, input: FriendsSettingsValues): Promise<FriendsContent> {
  const stored = { ...input, favorites: input.favorites.filter((f) => f.label), events: Object.fromEntries(Object.entries(input.events).filter(([, e]) => e.name || e.blurb)) };
  const [row] = await db
    .update(users)
    .set({ preferences: sql`coalesce(${users.preferences}, '{}'::jsonb) || ${JSON.stringify({ friends: stored })}::jsonb`, updatedAt: now() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning({ preferences: users.preferences });
  if (!row) throw new AppError("not_found", "This account no longer exists.");
  return friendsContentOf(row.preferences?.friends);
}

/** Resets friends mode to the default words. */
export async function resetFriendsSettings(db: DbOrTx, userId: string): Promise<FriendsContent> {
  await db
    .update(users)
    .set({ preferences: sql`coalesce(${users.preferences}, '{}'::jsonb) - 'friends'`, updatedAt: now() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  return friendsContentOf(undefined);
}

/** The user's personal standard event types, for the friendly names list. */
export async function friendsEventTypes(userId: string): Promise<{ slug: string; name: string; active: boolean }[]> {
  const db = await getDb();
  return db
    .select({ slug: eventTypes.slug, name: eventTypes.name, active: eventTypes.active })
    .from(eventTypes)
    .where(and(eq(eventTypes.ownerUserId, userId), eq(eventTypes.scope, "personal"), eq(eventTypes.type, "standard"), isNull(eventTypes.teamId), isNull(eventTypes.deletedAt), eq(eventTypes.secret, false)))
    .orderBy(asc(eventTypes.position), asc(eventTypes.createdAt));
}
