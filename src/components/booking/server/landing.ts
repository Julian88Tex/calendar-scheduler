// Landing page data (SPEC BK-01 user pages, BK-02 / TM-06 team pages). Server only.
//
// /{handle} resolves through `handles` to a live user or team. Users list their active, non-secret, personal standard
// event types ordered by position (ET-09, ET-10); teams use the teams contract (getTeamPublicProfile). Deleted users and
// teams are 404. System copy uses the owner's locale when supported, else English (invitee pages are English only).
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db";
import { eventTypes, handles, users } from "@/db/schema";
import { richTextToPlain } from "@/lib/html";
import { getTeamPublicProfile } from "@/lib/teams";
import { getLegalLinks, profileOf } from "./host";

export type LandingItem = { id: string; name: string; color: string; slug: string; description: string | null };

export type LandingData = {
  kind: "user" | "team";
  handle: string;
  name: string;
  avatarUrl: string | null;
  logoUrl: string | null;
  welcomeMessage: string | null;
  branding: { primaryColor: string | null; backgroundColor: string | null; textColor: string | null };
  ribbon: boolean;
  privacyUrl: string | null;
  items: LandingItem[];
};

function excerpt(plain: string | null | undefined, html: string | null | undefined): string | null {
  const text = (plain?.trim() || richTextToPlain(html ?? "")).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 300) : null;
}

/** The landing page of a handle, or null for unknown, deleted or malformed handles (404). */
export const loadLanding = cache(async (rawHandle: string): Promise<LandingData | null> => {
  let handle: string;
  try {
    handle = decodeURIComponent(rawHandle).trim().toLowerCase();
  } catch {
    return null;
  }
  if (!handle || handle.length > 100 || !/^[a-z0-9][a-z0-9-]*$/.test(handle)) return null;
  const db = await getDb();
  const [owner] = await db.select({ userId: handles.userId, teamId: handles.teamId }).from(handles).where(eq(handles.slug, handle)).limit(1);
  if (!owner) return null;

  if (owner.teamId) {
    const team = await getTeamPublicProfile(handle);
    if (!team) return null;
    const legal = await getLegalLinks();
    return {
      kind: "team",
      handle,
      name: team.team.name,
      avatarUrl: team.team.avatarUrl,
      logoUrl: null,
      welcomeMessage: team.team.welcomeMessage?.trim() || null,
      branding: { primaryColor: null, backgroundColor: null, textColor: null },
      ribbon: true,
      privacyUrl: legal.privacyUrl,
      items: team.eventTypes.map((e) => ({ id: e.id, name: e.name, color: e.color, slug: e.slug, description: excerpt(e.descriptionPlain, null) })),
    };
  }

  if (!owner.userId) return null;
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, owner.userId), isNull(users.deletedAt)))
    .limit(1);
  if (!u) return null;
  const legal = await getLegalLinks();
  const profile = profileOf(u, legal.privacyUrl);
  const types = await db
    .select({
      id: eventTypes.id,
      name: eventTypes.name,
      slug: eventTypes.slug,
      color: eventTypes.color,
      descriptionPlain: eventTypes.descriptionPlain,
      descriptionHtml: eventTypes.descriptionHtml,
    })
    .from(eventTypes)
    .where(
      and(
        eq(eventTypes.ownerUserId, u.id),
        eq(eventTypes.scope, "personal"),
        eq(eventTypes.type, "standard"),
        isNull(eventTypes.teamId),
        eq(eventTypes.active, true),
        eq(eventTypes.secret, false),
        isNull(eventTypes.deletedAt),
      ),
    )
    .orderBy(asc(eventTypes.position), asc(eventTypes.createdAt));
  return {
    kind: "user",
    handle,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    logoUrl: profile.logoUrl,
    welcomeMessage: profile.welcomeMessage,
    branding: { primaryColor: profile.brandColors.primary, backgroundColor: profile.brandColors.background, textColor: profile.brandColors.text },
    ribbon: profile.showBranding,
    privacyUrl: profile.privacyUrl,
    items: types.map((t) => ({ id: t.id, name: t.name, color: t.color, slug: t.slug, description: excerpt(t.descriptionPlain, t.descriptionHtml) })),
  };
});
