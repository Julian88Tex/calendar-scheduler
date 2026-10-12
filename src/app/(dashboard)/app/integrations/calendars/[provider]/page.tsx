// OWNER: calendar-integrations.
//
// /app/integrations/calendars/[provider] (ARCHITECTURE section 3.1, SPEC CAL-21). docs/SCOPE.md keeps Google Calendar
// only: "google" renders the integration page, every other provider (microsoft, icloud, caldav, ics) answers 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnectNotices } from "@/components/calendars/connect-notices";
import { GoogleCalendarIntegration } from "@/components/calendars/google-calendar-integration";
import { calendarNotices } from "@/components/calendars/notices";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { getActorCtx } from "@/lib/authz";
import { appName } from "@/lib/brand";
import { getCalendarSettingsView } from "@/lib/calendars/settings";

export const metadata: Metadata = { title: "Google Calendar" };

type Props = {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CalendarIntegrationPage({ params, searchParams }: Props) {
  const [{ provider }, sp] = await Promise.all([params, searchParams]);
  if (provider !== "google") notFound();
  const actor = await getActorCtx();
  const view = await getCalendarSettingsView(actor.user.id);
  const connected = view.connections.some((c) => c.provider === "google");
  return (
    <>
      <PageHeader
        title="Google Calendar"
        back={{ href: "/app/integrations", label: "Integrations & apps" }}
        badge={
          connected ? (
            <Badge variant="success">Connected</Badge>
          ) : !view.googleConfigured ? (
            <Badge variant="neutral">Not configured on this server</Badge>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6">
        <ConnectNotices notices={calendarNotices(sp, appName())} />
        <GoogleCalendarIntegration view={view} appName={appName()} isAdmin={actor.isInstanceAdmin} />
      </div>
    </>
  );
}
