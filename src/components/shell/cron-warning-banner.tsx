// OWNER: foundation-ui.
//
// CronWarningBanner (SPEC GEN-16): for instance admins when /api/cron last ran more than 15 minutes ago (or never):
// "Reminders may be sent late. Set up a pinger that calls /api/cron every 5 minutes." with a link to the setup steps on
// the Admin overview. The dashboard layout renders it only where cron is the trigger (Vercel; self-hosted servers run
// the in-process poller). Dismissible for the session.
"use client";

import Link from "next/link";
import { Banner } from "../ui/banner";
import { useSessionDismissal } from "./dismissal";

export type CronWarningBannerProps = {
  /** instance_settings.last_cron_at as ISO, or null when cron never ran. */
  lastCronAt: string | null;
  /** The business clock in ms (pass now() from the server for fake-time aware tests). */
  nowMs: number;
};

export const CRON_STALE_AFTER_MS = 15 * 60 * 1000;

/** True when the last tick is missing or older than 15 minutes. */
export function isCronStale(lastCronAt: string | null, nowMs: number): boolean {
  const last = lastCronAt ? Date.parse(lastCronAt) : Number.NaN;
  return !(Number.isFinite(last) && nowMs - last <= CRON_STALE_AFTER_MS);
}

export function CronWarningBanner({ lastCronAt, nowMs }: CronWarningBannerProps) {
  const [dismissed, dismiss] = useSessionDismissal("cron");
  if (!isCronStale(lastCronAt, nowMs) || dismissed) return null;
  return (
    <Banner
      variant="warning"
      role="status"
      dismissible
      onDismiss={dismiss}
      action={
        <Link href="/app/admin" className="text-[14px] font-bold text-warning-text underline underline-offset-2">
          See setup steps
        </Link>
      }
    >
      Reminders may be sent late. Set up a pinger that calls /api/cron every 5 minutes.
    </Banner>
  );
}
