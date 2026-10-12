// OWNER: booking-pages.
//
// /{handle}: the user landing page (SPEC BK-01) or team landing page (BK-02, TM-06): avatar, name, welcome message and
// the active, non-secret event types in a two-column grid ordered by position; each item links to its booking page
// with ?back=1 (prefill, UTM, display and embed parameters are forwarded). hide_landing_page_details=1 hides the
// header (BK-26); embeds post calendly.profile_page_viewed (BK-25). Unknown and deleted handles are 404 (BK-23).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmbedBeacon } from "@/components/booking/embed-beacon";
import { bt } from "@/components/booking/lib/t";
import { landingForwardParams, withCarried } from "@/components/booking/lib/url-state";
import { loadLanding } from "@/components/booking/server/landing";
import { EventTypeList } from "@/components/public/event-type-list";
import { LandingEmpty, LandingEvents, LandingFooter } from "@/components/public/landing-layout";
import { getOperatorEmail } from "@/components/public/operator";
import { ProfileHeader } from "@/components/public/profile-header";
import { PublicCard } from "@/components/public/public-card";
import { PublicFooterLinks } from "@/components/public/public-footer-links";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { embedDisplayParams } from "@/lib/embed-events";
import { absoluteUrl } from "@/lib/url";

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const data = await loadLanding(handle);
  if (!data) return { title: bt("states.notFoundTitle"), robots: { index: false, follow: false } };
  return {
    title: data.name,
    description: data.welcomeMessage ?? undefined,
    openGraph: { title: data.name, description: data.welcomeMessage ?? undefined, images: data.avatarUrl ? [absoluteUrl(data.avatarUrl)] : undefined },
  };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ handle }, sp] = await Promise.all([params, searchParams]);
  const data = await loadLanding(handle);
  if (!data) notFound();
  const embed = embedDisplayParams(sp);
  const forward = landingForwardParams(sp);
  const operatorEmail = await getOperatorEmail();
  const items = data.items.map((e) => ({
    id: e.id,
    name: e.name,
    color: e.color,
    description: e.description,
    href: withCarried(`/${encodeURIComponent(data.handle)}/${encodeURIComponent(e.slug)}?back=1`, forward),
  }));
  return (
    <PublicPageShell
      branding={{ primaryColor: embed.primaryColor ?? data.branding.primaryColor, backgroundColor: embed.backgroundColor ?? data.branding.backgroundColor, textColor: embed.textColor ?? data.branding.textColor }}
      embed={embed.embed}
      showFooterLinks={false}
      hideGdprBanner={embed.hideGdprBanner}
      operatorEmail={operatorEmail}
      privacyUrl={data.privacyUrl}
    >
      <PublicCard width="default" ribbon={data.ribbon} embed={embed.embed} className="min-[1000px]:min-h-[706px]">
        <ProfileHeader name={data.name} avatarUrl={data.avatarUrl} welcomeMessage={data.welcomeMessage} logoUrl={data.logoUrl} hidden={embed.hideLandingPageDetails} />
        <LandingEvents className={embed.hideLandingPageDetails ? "pt-6" : undefined}>
          {items.length > 0 ? <EventTypeList items={items} aria-label={bt("landing.eventTypes")} /> : <LandingEmpty name={data.name} />}
        </LandingEvents>
        <LandingFooter>
          <PublicFooterLinks operatorEmail={operatorEmail} showPrivacyPolicy={false} />
        </LandingFooter>
      </PublicCard>
      {embed.embed && <EmbedBeacon event="calendly.profile_page_viewed" />}
    </PublicPageShell>
  );
}
