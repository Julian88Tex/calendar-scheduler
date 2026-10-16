// OWNER: availability.
//
// /app/availability/advanced, the Advanced settings tab (SPEC AV-14, SCH-09; walkthrough 9.4; docs/SCOPE.md priorities
// 2 and 4): host-level meeting limits across all event types (max meetings per day, week or month), and the entry to
// the Troubleshoot view that shows why a time is unavailable. Holidays are out of scope (docs/SCOPE.md).
import { Stethoscope } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getActorCtx } from "@/lib/authz";
import { countHostMeetings, getMeetingLimits } from "@/lib/availability";
import { troubleshootHref } from "@/lib/availability/links";
import { log } from "@/lib/logger";
import { MeetingLimitsCard } from "./_components/meeting-limits-card";

export const metadata: Metadata = { title: "Advanced settings" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdvancedSettingsPage({ searchParams }: Props) {
  const [actor] = await Promise.all([getActorCtx(), searchParams]);
  const limits = await getMeetingLimits(actor.user.id);
  const counts = await countHostMeetings(actor.user.id).catch((e: unknown) => {
    log.warn("availability.meeting_counts_failed", { error: e });
    return null;
  });
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <MeetingLimitsCard limits={limits} counts={counts ? { day: counts.day, week: counts.week, month: counts.month } : null} />
      <Card padding="none">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-title-md font-bold text-ink">
              <Stethoscope aria-hidden="true" className="size-5 text-ink-2" />
              Troubleshoot availability
            </h2>
            <p className="mt-1 max-w-2xl text-body-md text-ink-2">
              Pick a date to see every start time of your event types and why each unavailable one is blocked: working hours, calendar
              events, buffers, minimum notice, date range or meeting limits.
            </p>
          </div>
          <Button asChild variant="secondary" className="shrink-0">
            <Link href={troubleshootHref()}>Open troubleshooter</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
