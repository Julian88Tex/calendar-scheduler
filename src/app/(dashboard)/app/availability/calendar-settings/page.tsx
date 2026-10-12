// OWNER: calendar-integrations.
//
// /app/availability/calendar-settings (ARCHITECTURE section 3.1, SPEC CAL-01..CAL-16, walkthrough 9.3; docs/SCOPE.md:
// Google Calendar only): connections, the calendars checked for conflicts, the calendar new events are added to and
// its sync settings, plus the API-17 calendar feed card (api-v1 contract, renders nothing while that module is
// skipped). Messages from the connect flow (?connected=, ?calendar_error=, ?oauth_error=) show once. Opening the page
// refreshes the Google calendar lists in the background (throttled).
import type { Metadata } from "next";
import { after } from "next/server";
import { CalendarSettings } from "@/components/calendars/calendar-settings";
import { ConnectNotices } from "@/components/calendars/connect-notices";
import { calendarNotices } from "@/components/calendars/notices";
import { CalendarFeedCard } from "@/components/developer/calendar-feed-card";
import { getActorCtx } from "@/lib/authz";
import { appName } from "@/lib/brand";
import { getCalendarSettingsView, refreshCalendarListsSoon } from "@/lib/calendars/settings";

export const metadata: Metadata = { title: "Calendar settings" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CalendarSettingsPage({ searchParams }: Props) {
  const [sp, actor] = await Promise.all([searchParams, getActorCtx()]);
  const view = await getCalendarSettingsView(actor.user.id);
  if (view.connections.some((c) => c.provider === "google")) after(() => refreshCalendarListsSoon(actor.user.id));
  const notices = calendarNotices(sp, appName());
  return (
    <div className="flex flex-col gap-6">
      <ConnectNotices notices={notices} />
      <CalendarSettings view={view} appName={appName()} isAdmin={actor.isInstanceAdmin} />
      <div className="max-w-[880px]">
        <CalendarFeedCard />
      </div>
    </div>
  );
}
