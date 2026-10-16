// OWNER: calendar-integrations.
//
// /app/integrations/calendars/[provider] (ARCHITECTURE section 3.1, SPEC CAL-21). docs/SCOPE.md keeps Google Calendar
// only: "google" renders the integration page, every other provider (microsoft, icloud, caldav, ics) answers 404.
// Below the Google Calendar card, the instance owner sees "Send emails from your Gmail" (booking emails sent from the
// owner's own Gmail, src/lib/email/gmail-view.ts); the Google consent round trip for it returns with ?gmail=requested.
// Emails that waited for a reconnect are released after the response once Gmail can send again.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ConnectNotices } from "@/components/calendars/connect-notices";
import { GoogleCalendarIntegration } from "@/components/calendars/google-calendar-integration";
import { calendarNotices } from "@/components/calendars/notices";
import { GmailSendingCard } from "@/components/integrations/gmail-sending-card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { getActorCtx } from "@/lib/authz";
import { appName } from "@/lib/brand";
import { getCalendarSettingsView } from "@/lib/calendars/settings";
import { getGmailSendingView, releaseHeldEmailsSoon } from "@/lib/email/gmail-view";
import { log } from "@/lib/logger";

export const metadata: Metadata = { title: "Google Calendar" };

type Props = {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CalendarIntegrationPage({ params, searchParams }: Props) {
  const [{ provider }, sp] = await Promise.all([params, searchParams]);
  if (provider !== "google") notFound();
  const actor = await getActorCtx();
  const [view, gmail] = await Promise.all([
    getCalendarSettingsView(actor.user.id),
    getGmailSendingView(actor, { requested: sp.gmail === "requested" }).catch((e: unknown) => {
      log.warn("integrations.gmail_view_failed", { error: e });
      return null;
    }),
  ]);
  if (gmail && gmail.heldCount > 0 && gmail.state !== "needs_reconnect") after(() => releaseHeldEmailsSoon());
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
        {gmail && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <GmailSendingCard view={gmail} appName={appName()} />
          </div>
        )}
      </div>
    </>
  );
}
