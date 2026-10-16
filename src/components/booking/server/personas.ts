// Personas (lib/personas.ts). Server only. The host's personas come from users.preferences; an event type's from
// event_types.metadata.personas. The old friends link (/friends) belongs to the instance owner (the owner of the oldest
// organization, which on this single-owner instance is the one account); its paths redirect to the owner's public
// pages with ?for=friends.
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db";
import { eventTypes, handles, organizationMemberships, organizations, users } from "@/db/schema";
import { PERSONA_PARAM } from "../lib/friends";
import { FRIENDS_PERSONA, eventPersonasOf, personasOf, type EventPersonas, type Persona } from "../lib/personas";

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

/** The query of an old friends link request pointed at the friends persona (the rest kept, so month, date and back survive). */
export function friendsQuery(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === "string" && k !== PERSONA_PARAM && k !== "friends") q.append(k, value);
  }
  q.set(PERSONA_PARAM, FRIENDS_PERSONA.id);
  return q.toString();
}

const userPreferences = cache(async (userId: string): Promise<unknown> => {
  const db = await getDb();
  const [row] = await db.select({ preferences: users.preferences }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
  return row?.preferences ?? null;
});

/** The host's personas (Settings > Personas); none for unknown users. */
export const loadPersonas = cache(async (userId: string | null | undefined): Promise<Persona[]> => (userId ? personasOf(await userPreferences(userId)) : []));

/** The personas one event type is shown to, with its wording for each. */
export const loadEventPersonas = cache(async (eventTypeId: string): Promise<EventPersonas> => {
  const db = await getDb();
  const [row] = await db
    .select({ slug: eventTypes.slug, metadata: eventTypes.metadata, ownerUserId: eventTypes.ownerUserId })
    .from(eventTypes)
    .where(eq(eventTypes.id, eventTypeId))
    .limit(1);
  if (!row) return {};
  return eventPersonasOf(row.metadata, row.slug, row.ownerUserId ? await userPreferences(row.ownerUserId) : null);
});

/** The owner's preferences for eventPersonasOf on lists of event types (the landing page). */
export async function ownerPreferences(userId: string): Promise<unknown> {
  return userPreferences(userId);
}
