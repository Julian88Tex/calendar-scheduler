// OWNER: settings-onboarding.
//
// /app/settings/branding (SPEC BR-05, BR-06; walkthrough 18 "Branding"; docs/SCOPE.md item 14): the logo shown at the
// top of the booking page panel, the landing page and email headers, and the "Use {AppName} branding" switch that
// shows or hides the Powered by ribbon, with a live preview of the booking page panel.
import type { Metadata } from "next";
import { BrandingSettings } from "@/components/settings/branding-settings";
import { PageHeader } from "@/components/ui/page-header";
import { getActorCtx } from "@/lib/authz";
import { avatarUrlOf, brandingPreviewEvent, logoUrlOf } from "@/lib/settings";
import { formatDuration } from "@/lib/time/format";

export const metadata: Metadata = { title: "Branding" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BrandingPage({ searchParams }: Props) {
  const [actor] = await Promise.all([getActorCtx(), searchParams]);
  const { user } = actor;
  const event = await brandingPreviewEvent(user.id);
  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader title="Branding" description="Make your booking pages and notifications look like your business." />
      <BrandingSettings
        logoUrl={logoUrlOf(user)}
        showBranding={user.showBranding}
        preview={{
          name: user.name,
          avatarUrl: avatarUrlOf(user),
          eventName: event?.name ?? "30 Minute Meeting",
          durationLabel: formatDuration(event?.durationMinutes ?? 30),
        }}
      />
    </div>
  );
}
