// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Delivery timing (SPEC NT-23, GEN-16): helpers for timed jobs and the trigger freshness warnings.
// - reminderDecision: a reminder that runs late still sends (even more than 30 minutes late) unless its meeting has
//   already started; then it is skipped with reason "too_late". Workflows calls it before sending a "before event"
//   message.
// - getCronStatus: instance_settings.last_cron_at and whether it is older than 15 minutes (the admin overview warning,
//   ADM-03, and the workflow builder hint for timings under 30 minutes, NT-11).
import "server-only";
import { eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { instanceSettings } from "@/db/schema";
import { now } from "../time/now";

/** last_cron_at older than this triggers the freshness warnings. */
export const CRON_STALE_MS = 15 * 60 * 1000;
/** Reminders this late are logged as late (they still send while the meeting has not started). */
export const REMINDER_LATE_MS = 30 * 60 * 1000;

export type ReminderDecision = { send: true; late: boolean; lateMs: number } | { send: false; reason: "too_late"; lateMs: number };

/** Whether a timed "before the meeting" message should still go out at `at` (default now()). */
export function reminderDecision(p: { meetingStartAt: Date; dueAt: Date; at?: Date }): ReminderDecision {
  const at = (p.at ?? now()).getTime();
  const lateMs = Math.max(0, at - p.dueAt.getTime());
  if (at >= p.meetingStartAt.getTime()) return { send: false, reason: "too_late", lateMs };
  return { send: true, late: lateMs > REMINDER_LATE_MS, lateMs };
}

export type CronStatus = { lastCronAt: Date | null; stale: boolean };

/** The last /api/cron tick and whether it is stale (never ran counts as stale). */
export async function getCronStatus(db?: DbOrTx, at: Date = now()): Promise<CronStatus> {
  const d = db ?? (await getDb());
  const [row] = await d.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, "last_cron_at")).limit(1);
  const ms = typeof row?.value === "string" ? Date.parse(row.value) : Number.NaN;
  const lastCronAt = Number.isFinite(ms) ? new Date(ms) : null;
  return { lastCronAt, stale: !lastCronAt || at.getTime() - lastCronAt.getTime() > CRON_STALE_MS };
}
