// OWNER: booking-pages.
//
// /{handle}: the user landing page (SPEC BK-01) or team landing page (BK-02, TM-06): avatar, name, welcome message and
// the active, non-secret event types in a two-column grid ordered by position; each item links to its booking page
// with ?back=1 (prefill, UTM, display and embed parameters are forwarded). hide_landing_page_details=1 hides the
// header (BK-26); embeds post calendly.profile_page_viewed (BK-25). Unknown and deleted handles are 404 (BK-23). Like
// Calendly's profile card, the footer shows only "Cookie settings" (docs/research/calendly-live-capture.md item 20).
// ?friends=1 on a user's page is friends mode (lib/friends.ts): the FriendsLanding card in the friends theme, never
// indexed, with the Friends / Business toggle (shown whenever the parameter is present, friends=0 included).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmbedBeacon } from "@/components/booking/embed-beacon";
import { FRIENDS_PARAM, firstNameOf, friendsLine, toneOfParam } from "@/components/booking/lib/friends";
import { bt } from "@/components/booking/lib/t";
import { landingForwardParams, withCarried } from "@/components/booking/lib/url-state";
import { loadFriendsContent } from "@/components/booking/server/friends";
import { loadLanding } from "@/components/booking/server/landing";
import { FriendsLanding } from "@/components/public/friends-landing";
import { PUBLIC_TEXT_TRACKING } from "@/components/public/booking-card";
import { EventTypeList } from "@/components/public/event-type-list";
import { LandingEmpty, LandingEvents, LandingFooter } from "@/components/public/landing-layout";
import { ProfileHeader } from "@/components/public/profile-header";
import { PublicCard } from "@/components/public/public-card";
import { PublicFooterLinks } from "@/components/public/public-footer-links";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { cn } from "@/lib/cn";
import { embedDisplayParams } from "@/lib/embed-events";
import { absoluteUrl } from "@/lib/url";

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function friendsParam(sp: Record<string, string | string[] | undefined>): string | undefined {
  const v = sp[FRIENDS_PARAM];
  return Array.isArray(v) ? v[0] : v;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ handle }, sp] = await Promise.all([params, searchParams]);
  const data = await loadLanding(handle);
  if (!data) return { title: bt("states.notFoundTitle"), robots: { index: false, follow: false } };
  if (data.kind === "user" && toneOfParam(friendsParam(sp)) === "friends") {
    const content = await loadFriendsContent(data.userId);
    const title = friendsLine("landingTitle", firstNameOf(data.name));
    return { title, description: content.greeting, robots: { index: false, follow: false }, openGraph: { title, description: content.note } };
  }
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
  const items = data.items.map((e) => ({
    id: e.id,
    name: e.name,
    color: e.color,
    description: e.description,
    href: withCarried(`/${encodeURIComponent(data.handle)}/${encodeURIComponent(e.slug)}?back=1`, forward),
  }));
  const toggle = data.kind === "user" && friendsParam(sp) !== undefined && !embed.embed;
  if (toggle && toneOfParam(friendsParam(sp)) === "friends") {
    const content = await loadFriendsContent(data.userId);
    const hrefOf = (slug: string) => withCarried(`/${encodeURIComponent(data.handle)}/${encodeURIComponent(slug)}?back=1`, forward);
    return (
      <PublicPageShell tone="friends" showToneToggle showFooterLinks={false} hideGdprBanner={embed.hideGdprBanner} privacyUrl={data.privacyUrl}>
        <FriendsLanding data={data} content={content} hrefOf={hrefOf} />
      </PublicPageShell>
    );
  }
  return (
    <PublicPageShell
      branding={{ primaryColor: embed.primaryColor ?? data.branding.primaryColor, backgroundColor: embed.backgroundColor ?? data.branding.backgroundColor, textColor: embed.textColor ?? data.branding.textColor }}
      embed={embed.embed}
      showFooterLinks={false}
      hideGdprBanner={embed.hideGdprBanner}
      privacyUrl={data.privacyUrl}
      showToneToggle={toggle}
    >
      <PublicCard width="default" ribbon={data.ribbon} embed={embed.embed} className={cn("min-[1000px]:min-h-[706px]", PUBLIC_TEXT_TRACKING)}>
        <ProfileHeader name={data.name} avatarUrl={data.avatarUrl} welcomeMessage={data.welcomeMessage} logoUrl={data.logoUrl} hidden={embed.hideLandingPageDetails} />
        <LandingEvents className={embed.hideLandingPageDetails ? "pt-6" : undefined}>
          {items.length > 0 ? <EventTypeList items={items} aria-label={bt("landing.eventTypes")} /> : <LandingEmpty name={data.name} />}
        </LandingEvents>
        <LandingFooter>
          <PublicFooterLinks showPrivacyPolicy={false} />
        </LandingFooter>
      </PublicCard>
      {embed.embed && <EmbedBeacon event="calendly.profile_page_viewed" />}
    </PublicPageShell>
  );
}
