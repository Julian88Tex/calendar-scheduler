// OWNER: foundation-ui.
//
// Server-side data for the dashboard shell (SPEC GEN-16, GEN-19, GEN-20, ET-02, BR-15): the cron tick, whether the
// cron warning applies on this deployment, the Create menu's multi-host data and the user's public link.
import "server-only";
import { and, count, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { instanceSettings, organizationMemberships } from "@/db/schema";
import type { CreateMenuMultiHost } from "@/components/shell/create-menu";
import { isOrgAdmin, type ActorCtx } from "@/lib/authz";
import { isE2eMode, isVercel } from "@/lib/env";
import { log } from "@/lib/logger";
import { listTeamsForUser } from "@/lib/teams";
import { absoluteUrl } from "@/lib/url";

/** instance_settings.last_cron_at as ISO, or null. */
export async function getLastCronAt(): Promise<string | null> {
  try {
    const db = await getDb();
    const [row] = await db.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, "last_cron_at")).limit(1);
    const v = row?.value;
    return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
  } catch (e) {
    log.warn("shell.last_cron_failed", { error: e });
    return null;
  }
}

/**
 * Whether the GEN-16 cron warning applies: on Vercel cron is the only trigger (a missing tick counts as stale);
 * self-hosted servers run the in-process poller (no warning). E2E runs have no poller either, but warn only once a
 * tick was recorded, so other suites are not affected by a fresh database.
 */
export function cronWarningApplies(lastCronAt: string | null): boolean {
  if (isVercel()) return true;
  if (isE2eMode()) return lastCronAt !== null;
  return false;
}

/** Teams the user can manage and whether the workspace has other members (ET-02 multi-host step). */
export async function getCreateMenuData(actor: ActorCtx): Promise<CreateMenuMultiHost> {
  try {
    const db = await getDb();
    const [teams, others] = await Promise.all([
      listTeamsForUser(actor.user.id),
      db
        .select({ n: count() })
        .from(organizationMemberships)
        .where(and(eq(organizationMemberships.organizationId, actor.orgId), ne(organizationMemberships.userId, actor.user.id))),
    ]);
    const admin = isOrgAdmin(actor);
    return {
      teams: teams.filter((t) => admin || t.role === "manager").map((t) => ({ id: t.id, name: t.name })),
      hasOtherMembers: (others[0]?.n ?? 0) > 0,
      canInvite: admin,
    };
  } catch (e) {
    log.warn("shell.create_menu_failed", { error: e });
    return { teams: [], hasOtherMembers: true, canInvite: isOrgAdmin(actor) };
  }
}

/** The user's landing page URL (null before onboarding picks a handle). */
export function publicLinkFor(slug: string | null): string | null {
  return slug ? absoluteUrl(`/${slug}`) : null;
}
