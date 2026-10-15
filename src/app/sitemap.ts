// sitemap.xml (SPEC GEN-13; ARCHITECTURE section 23: dynamic, never prerendered at build, so a build without a
// database URL succeeds). Lists the privacy and terms pages, every public landing page (users and teams) and their
// public event types (active, standard, not secret). Not "/": it only redirects (to /login, or the app when signed
// in) and is noindex. Not /cookie-policy or /help while they are placeholder pages. Falls back to the legal pages when
// the database is unavailable (setup mode on Vercel).
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { getDb } from "@/db";
import { eventTypes, teams, users } from "@/db/schema";
import { log } from "@/lib/logger";
import { appUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

const STATIC_PAGES = ["/privacy", "/terms"];
const LIMIT = 5000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appUrl();
  const entries: MetadataRoute.Sitemap = STATIC_PAGES.map((path) => ({ url: `${base}${path}`, changeFrequency: "monthly", priority: 0.3 }));
  try {
    const db = await getDb();
    const userRows = await db
      .select({ slug: users.slug, updatedAt: users.updatedAt })
      .from(users)
      .where(and(isNull(users.deletedAt), isNotNull(users.slug)))
      .limit(LIMIT);
    const teamRows = await db
      .select({ slug: teams.slug, updatedAt: teams.updatedAt })
      .from(teams)
      .where(isNull(teams.deletedAt))
      .limit(LIMIT);
    const typeRows = await db
      .select({ slug: eventTypes.slug, updatedAt: eventTypes.updatedAt, userSlug: users.slug, teamSlug: teams.slug })
      .from(eventTypes)
      .leftJoin(users, and(eq(users.id, eventTypes.ownerUserId), isNull(users.deletedAt)))
      .leftJoin(teams, and(eq(teams.id, eventTypes.teamId), isNull(teams.deletedAt)))
      .where(
        and(
          isNull(eventTypes.deletedAt),
          eq(eventTypes.active, true),
          eq(eventTypes.secret, false),
          eq(eventTypes.type, "standard"),
          ne(eventTypes.scope, "shared"),
        ),
      )
      .limit(LIMIT);
    for (const r of [...userRows, ...teamRows]) {
      if (r.slug) entries.push({ url: `${base}/${r.slug}`, lastModified: r.updatedAt, changeFrequency: "weekly", priority: 0.6 });
    }
    for (const r of typeRows) {
      const handle = r.teamSlug ?? r.userSlug;
      if (handle) entries.push({ url: `${base}/${handle}/${r.slug}`, lastModified: r.updatedAt, changeFrequency: "weekly", priority: 0.5 });
    }
  } catch (e) {
    log.warn("sitemap.database_unavailable", { error: e });
  }
  return entries;
}
