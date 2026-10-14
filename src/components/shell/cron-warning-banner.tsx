// OWNER: foundation-ui.
//
// CronWarningBanner (SPEC GEN-16, docs/SCOPE.md priority 5): for instance admins when /api/cron last ran more than 15
// minutes ago (or never): "Reminders may be sent late. Set up a pinger that calls /api/cron every 5 minutes." with a
// "See setup steps" button that opens the setup instructions in a dialog (a free external pinger every 5 minutes, the
// exact URL with a copy button, the Authorization header when CRON_SECRET is set, and when cron last ran). The cron
// staleness check applies only where cron is the trigger (Vercel; self-hosted servers run the in-process poller,
// checkCron=false). On any deployment, reminders more than 15 minutes past their send time (getReminderDeliveryHealth
// overdueCount) also show it: "{n} reminders are past their send time." Dismissible for the session.
"use client";

import { useState } from "react";
import { Banner } from "../ui/banner";
import { CopyButton } from "../ui/copy-button";
import { Dialog } from "../ui/dialog";
import { useSessionDismissal } from "./dismissal";

export type CronWarningBannerProps = {
  /** instance_settings.last_cron_at as ISO, or null when cron never ran. */
  lastCronAt: string | null;
  /** The business clock in ms (pass now() from the server for fake-time aware tests). */
  nowMs: number;
  /** Absolute URL of the cron endpoint shown in the setup steps (default "/api/cron"). */
  cronUrl?: string;
  /** CRON_SECRET is set: the pinger must send "Authorization: Bearer {CRON_SECRET}". */
  secretConfigured?: boolean;
  /** Cron is the job trigger on this deployment, so a stale tick warns (default true; false on self-hosted servers). */
  checkCron?: boolean;
  /** Reminders more than 15 minutes past their send time (getReminderDeliveryHealth().overdueCount). */
  overdueReminders?: number;
};

export const CRON_STALE_AFTER_MS = 15 * 60 * 1000;

/** True when the last tick is missing or older than 15 minutes. */
export function isCronStale(lastCronAt: string | null, nowMs: number): boolean {
  const last = lastCronAt ? Date.parse(lastCronAt) : Number.NaN;
  return !(Number.isFinite(last) && nowMs - last <= CRON_STALE_AFTER_MS);
}

/** "Never", "Less than a minute ago", "20 minutes ago", "3 hours ago", "2 days ago". */
export function cronLastRunLabel(lastCronAt: string | null, nowMs: number): string {
  const last = lastCronAt ? Date.parse(lastCronAt) : Number.NaN;
  if (!Number.isFinite(last)) return "Never";
  const minutes = Math.floor(Math.max(0, nowMs - last) / 60_000);
  if (minutes < 1) return "Less than a minute ago";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

/** "1 reminder is past its send time." / "{n} reminders are past their send time." */
export function overdueRemindersLabel(n: number): string {
  return n === 1 ? "1 reminder is past its send time." : `${n} reminders are past their send time.`;
}

/** The banner text, or null when nothing is wrong (cron fresh or not the trigger, and no overdue reminders). */
export function cronBannerMessage({ stale, overdueReminders = 0 }: { stale: boolean; overdueReminders?: number }): string | null {
  const pinger = "Set up a pinger that calls /api/cron every 5 minutes.";
  if (overdueReminders > 0) return stale ? `${overdueRemindersLabel(overdueReminders)} ${pinger}` : overdueRemindersLabel(overdueReminders);
  return stale ? `Reminders may be sent late. ${pinger}` : null;
}

function CronSetupSteps({ cronUrl, secretConfigured, lastRun, overdue }: { cronUrl: string; secretConfigured: boolean; lastRun: string; overdue: boolean }) {
  return (
    <div className="flex flex-col gap-4 text-body-md text-ink">
      <p>
        Reminder emails and other timed jobs run whenever /api/cron is called. The built-in schedules run only every 10 minutes (GitHub Actions) or
        once a day (Vercel Cron on the Hobby plan), so add a free pinger to send reminders on time.
      </p>
      <ol className="flex list-decimal flex-col gap-3 pl-5">
        <li>Create a free cron job at cron-job.org, or a schedule in Upstash QStash.</li>
        <li className="flex flex-col gap-2">
          <span>Have it call this URL every 5 minutes (GET or POST):</span>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <code className="min-w-0 rounded-[6px] border border-line bg-pebble px-2 py-1 text-[13px] break-all text-ink">{cronUrl}</code>
            <CopyButton value={cronUrl} size="sm" label="Copy URL" toastMessage="URL copied" />
          </span>
        </li>
        <li>
          {secretConfigured ? (
            <>
              Add the request header <code className="text-[13px]">Authorization: Bearer</code> followed by your CRON_SECRET value. Calls without it are
              rejected.
            </>
          ) : (
            <>
              Recommended: set CRON_SECRET in your environment variables and send it in the header{" "}
              <code className="text-[13px]">Authorization: Bearer</code> followed by the secret. Without it the URL stays open but runs at most once a
              minute.
            </>
          )}
        </li>
      </ol>
      <p className="text-ink-2">
        Last run: <span className="font-semibold text-ink">{lastRun}</span>.{" "}
        {overdue ? "This notice disappears once the late reminders are sent." : "This notice disappears once a run is recorded."}
      </p>
    </div>
  );
}

export function CronWarningBanner({ lastCronAt, nowMs, cronUrl, secretConfigured = false, checkCron = true, overdueReminders = 0 }: CronWarningBannerProps) {
  const [dismissed, dismiss] = useSessionDismissal("cron");
  const [open, setOpen] = useState(false);
  const message = cronBannerMessage({ stale: checkCron && isCronStale(lastCronAt, nowMs), overdueReminders });
  if (!message || dismissed) return null;
  const url = cronUrl ?? "/api/cron";
  return (
    <>
      <Banner
        variant="warning"
        role="status"
        dismissible
        onDismiss={dismiss}
        action={
          <button type="button" onClick={() => setOpen(true)} className="text-[14px] font-bold text-warning-text underline underline-offset-2">
            See setup steps
          </button>
        }
      >
        {message}
      </Banner>
      <Dialog open={open} onOpenChange={setOpen} title="Set up a pinger" size="md">
        <CronSetupSteps cronUrl={url} secretConfigured={secretConfigured} lastRun={cronLastRunLabel(lastCronAt, nowMs)} overdue={overdueReminders > 0} />
      </Dialog>
    </>
  );
}
