// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// CronWarningBanner (SPEC GEN-16): for admins, when /api/cron last ran more than 15 minutes ago (or never).
import Link from "next/link";
import { Banner } from "../ui/banner";

export type CronWarningBannerProps = {
  /** instance_settings.last_cron_at as ISO, or null when cron never ran. */
  lastCronAt: string | null;
  /** The business clock in ms (pass now() from the server for fake-time aware tests). */
  nowMs: number;
};

export const CRON_STALE_AFTER_MS = 15 * 60 * 1000;

export function CronWarningBanner({ lastCronAt, nowMs }: CronWarningBannerProps) {
  const last = lastCronAt ? Date.parse(lastCronAt) : NaN;
  if (Number.isFinite(last) && nowMs - last <= CRON_STALE_AFTER_MS) return null;
  return (
    <Banner variant="warning" dismissible action={<Link href="/app/admin">Set up cron</Link>}>
      Background jobs have not run in the last 15 minutes. Reminders and emails may be delayed.
    </Banner>
  );
}
