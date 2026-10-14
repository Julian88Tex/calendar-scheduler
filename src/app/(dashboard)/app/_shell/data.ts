// OWNER: foundation-ui.
//
// Server-side data for the dashboard shell (SPEC GEN-16, GEN-20, BR-15): the cron tick, whether the cron warning applies
// on this deployment, the number of overdue reminders (any deployment), the cron endpoint URL for its setup steps and the
// user's public link.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { instanceSettings } from "@/db/schema";
import { isE2eMode, isVercel } from "@/lib/env";
import { log } from "@/lib/logger";
import { absoluteUrl } from "@/lib/url";
import { getReminderDeliveryHealth } from "@/lib/workflows";

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

/** Reminders more than 15 minutes past their send time across the instance (0 when the check fails). */
export async function getOverdueReminderCount(): Promise<number> {
  try {
    return (await getReminderDeliveryHealth()).overdueCount;
  } catch (e) {
    log.warn("shell.reminder_health_failed", { error: e });
    return 0;
  }
}

/** The absolute /api/cron URL for the GEN-16 setup steps. */
export function cronEndpointUrl(): string {
  return absoluteUrl("/api/cron");
}

/** The user's landing page URL (null before onboarding picks a handle). */
export function publicLinkFor(slug: string | null): string | null {
  return slug ? absoluteUrl(`/${slug}`) : null;
}
