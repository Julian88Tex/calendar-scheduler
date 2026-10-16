// OWNER: foundation-ui.
//
// CalendarProblemBanner (SPEC CAL-15): the red dashboard banner "There is a problem with your calendar connection.
// Reconnect" while a connection is needs_reauth or error (calendars.getCalendarHealth). Dismissible for the session.
"use client";

import Link from "next/link";
import { Banner } from "../ui/banner";
import { useSessionDismissal } from "./dismissal";

export type CalendarProblemBannerProps = { brokenConnections: { id: string; email: string | null; status: string }[] };

export function CalendarProblemBanner({ brokenConnections }: CalendarProblemBannerProps) {
  const key = `calendar:${brokenConnections.map((c) => `${c.id}:${c.status}`).join(",")}`;
  const [dismissed, dismiss] = useSessionDismissal(key);
  if (!brokenConnections.length || dismissed) return null;
  const emails = brokenConnections.map((c) => c.email).filter((e): e is string => Boolean(e));
  return (
    <Banner
      variant="error"
      role="status"
      dismissible
      onDismiss={dismiss}
      action={
        <Link href="/app/availability/calendar-settings" className="text-[14px] font-bold text-danger-text underline underline-offset-2">
          Reconnect
        </Link>
      }
    >
      <span>
        There is a problem with your calendar connection.
        {emails.length > 0 && <span className="text-ink-2"> ({emails.join(", ")})</span>}
      </span>
    </Banner>
  );
}
