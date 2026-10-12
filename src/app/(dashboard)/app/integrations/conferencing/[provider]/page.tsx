// OWNER: conferencing.
//
// /app/integrations/conferencing/[provider] (ARCHITECTURE section 3.1, SPEC VID-07, CAL-21). docs/SCOPE.md keeps Google
// Meet only: "google-meet" renders the integration page; zoom, microsoft-teams, jitsi, webex, gotomeeting and anything
// else answer 404 (no screen offers them).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GoogleMeetIntegration, meetConnectNotices } from "@/components/conferencing/google-meet-integration";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { getActorCtx } from "@/lib/authz";
import { appName } from "@/lib/brand";
import { getGoogleMeetStatus, listMeetEventTypes } from "@/lib/conferencing/options";

export const metadata: Metadata = { title: "Google Meet" };

type Props = {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ConferencingIntegrationPage({ params, searchParams }: Props) {
  const [{ provider }, sp] = await Promise.all([params, searchParams]);
  if (provider !== "google-meet") notFound();
  const actor = await getActorCtx();
  const [status, eventTypes] = await Promise.all([getGoogleMeetStatus(actor.user.id), listMeetEventTypes(actor.user.id)]);
  const connected = status.accounts.length > 0;
  return (
    <>
      <PageHeader
        title="Google Meet"
        back={{ href: "/app/integrations", label: "Integrations & apps" }}
        badge={
          connected ? (
            <Badge variant="success">Connected</Badge>
          ) : !status.serverConfigured ? (
            <Badge variant="neutral">Not configured on this server</Badge>
          ) : undefined
        }
      />
      <GoogleMeetIntegration status={status} eventTypes={eventTypes} appName={appName()} isAdmin={actor.isInstanceAdmin} notices={meetConnectNotices(sp, appName())} />
    </>
  );
}
