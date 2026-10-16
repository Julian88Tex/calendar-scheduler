// Copy of the "Reminders may be sent late" warning (SPEC GEN-16, NT-11, NT-23; docs/SCOPE.md priority 5), shared by
// the event type reminders section and its dialog. Pure and client safe: it only formats the delivery view.
import type { ReminderDeliveryView } from "./types";

/** "Never", "Less than a minute ago", "20 minutes ago", "3 hours ago", "2 days ago" (the dashboard banner wording). */
export function lastRunLabel(lastCronAt: string | null, nowMs: number): string {
  const last = lastCronAt ? Date.parse(lastCronAt) : Number.NaN;
  if (!Number.isFinite(last)) return "Never";
  const minutes = Math.floor(Math.max(0, nowMs - last) / 60_000);
  if (minutes < 1) return "Less than a minute ago";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** The first sentence of the warning: what is wrong right now (overdue reminders win over the cron freshness). */
export function deliveryProblem(delivery: Pick<ReminderDeliveryView, "overdueCount" | "lastCronAt" | "nowMs">): string {
  const n = delivery.overdueCount;
  if (n === 1) return "1 reminder is past its send time and has not gone out yet.";
  if (n > 1) return `${n} reminders are past their send time and have not gone out yet.`;
  return `Scheduled jobs last ran: ${lastRunLabel(delivery.lastCronAt, delivery.nowMs)}.`;
}

/** What to do about it, for the way this deployment dispatches jobs (cron on Vercel, the poller when self-hosted). */
export function deliveryRemedy(delivery: Pick<ReminderDeliveryView, "dispatcher" | "cronSecretConfigured">): string {
  const pinger = "set up a pinger (for example cron-job.org) that calls this URL every 5 minutes";
  const header = delivery.cronSecretConfigured ? ", with the header Authorization: Bearer followed by your CRON_SECRET" : "";
  return delivery.dispatcher === "cron"
    ? `Reminders go out when /api/cron runs. To send them on time, ${pinger}${header}.`
    : `This server's background job runner sends reminders and it is not keeping up. Check that the server is running, or ${pinger}${header}.`;
}
