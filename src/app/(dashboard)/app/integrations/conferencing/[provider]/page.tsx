// OWNER: conferencing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/integrations/conferencing/[provider] placeholder (ARCHITECTURE section 3.1, SPEC VID-07..VID-10, VID-16): zoom,
// google-meet, microsoft-teams, jitsi, webex and gotomeeting; other providers answer 404. The owner replaces it with
// the real page.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Conferencing integration" };

const TITLES: Record<string, string> = {
  zoom: "Zoom",
  "google-meet": "Google Meet",
  "microsoft-teams": "Microsoft Teams",
  jitsi: "Jitsi Meet",
  webex: "Webex",
  gotomeeting: "GoTo Meeting",
};

type Props = {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ConferencingIntegrationPage({ params, searchParams }: Props) {
  const [{ provider }] = await Promise.all([params, searchParams]);
  const title = TITLES[provider];
  if (!title) notFound();
  return (
    <>
      <PageHeader title={title} back={{ href: "/app/integrations", label: "Integrations & apps" }} />
      <EmptyState heading="This page is being built." />
    </>
  );
}
