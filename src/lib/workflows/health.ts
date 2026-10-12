// Reminder delivery health (SPEC GEN-16, NT-11, NT-23; docs/SCOPE.md priority 5): whether timed reminders can be
// trusted to go out on time on this deployment.
// - dispatcher "cron": on Vercel only /api/cron (plus after() and opportunistic page runs) dispatches due jobs, so a
//   stale instance_settings.last_cron_at (older than 15 minutes, or never) means reminders can be late. E2E runs have
//   no poller either and follow the same rule once a tick was recorded (like the dashboard banner).
// - dispatcher "poller": self-hosted servers run the in-process poller every 30 seconds; no cron needed.
// - overdue: scheduled executions more than 15 minutes past their run time, for any dispatcher. This catches a broken
//   dispatcher even when cron ticks are recorded (for example a failing job runner), so the owner sees real
//   symptoms rather than only the trigger's freshness.
import "server-only";
import { and, count, eq, lt, min } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { scheduledEvents, workflowExecutions } from "@/db/schema";
import { isE2eMode, isVercel } from "@/lib/env";
import { CRON_STALE_MS, getCronStatus } from "@/lib/jobs/timing";
import { now as clockNow } from "@/lib/time/now";

/** A scheduled execution this far past its run time counts as overdue. */
export const OVERDUE_AFTER_MS = 15 * 60 * 1000;

export type ReminderDeliveryHealth = {
  dispatcher: "cron" | "poller";
  /** instance_settings.last_cron_at (ISO) or null. */
  lastCronAt: string | null;
  /** The cron trigger is what dispatches jobs here and it has not run in the last 15 minutes. */
  cronStale: boolean;
  /** Scheduled messages more than 15 minutes overdue (scoped to the organization when given). */
  overdueCount: number;
  oldestOverdueAt: string | null;
  /** Show a warning: cron is stale where it matters, or messages are overdue. */
  warning: boolean;
};

/** Reminder delivery health for the dashboard and the event type reminders section (see the file header). */
export async function getReminderDeliveryHealth(opts: { organizationId?: string | null; db?: DbOrTx; at?: Date } = {}): Promise<ReminderDeliveryHealth> {
  const db = opts.db ?? (await getDb());
  const at = opts.at ?? clockNow();
  const cron = await getCronStatus(db, at);
  const cronDispatches = isVercel() || (isE2eMode() && cron.lastCronAt !== null);
  const cronStale = cronDispatches && cron.stale;
  const threshold = new Date(at.getTime() - OVERDUE_AFTER_MS);
  const base = and(eq(workflowExecutions.status, "scheduled"), lt(workflowExecutions.runAt, threshold));
  const [row] = opts.organizationId
    ? await db
        .select({ n: count(), oldest: min(workflowExecutions.runAt) })
        .from(workflowExecutions)
        .innerJoin(scheduledEvents, eq(scheduledEvents.id, workflowExecutions.scheduledEventId))
        .where(and(base, eq(scheduledEvents.organizationId, opts.organizationId)))
    : await db.select({ n: count(), oldest: min(workflowExecutions.runAt) }).from(workflowExecutions).where(base);
  const overdueCount = Number(row?.n ?? 0);
  const oldest = row?.oldest ? new Date(row.oldest as unknown as string | Date) : null;
  return {
    dispatcher: isVercel() || isE2eMode() ? "cron" : "poller",
    lastCronAt: cron.lastCronAt?.toISOString() ?? null,
    cronStale,
    overdueCount,
    oldestOverdueAt: oldest && Number.isFinite(oldest.getTime()) ? oldest.toISOString() : null,
    warning: cronStale || overdueCount > 0,
  };
}

/** Exported for the cron freshness copy: the staleness window of the trigger (15 minutes). */
export const CRON_STALE_AFTER_MS = CRON_STALE_MS;
