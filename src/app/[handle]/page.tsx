// OWNER: booking-pages.
//
// /{handle}: the user landing page (SPEC BK-01) or team landing page (BK-02, TM-06): avatar, name, welcome message and
// the active, non-secret event types in a two-column grid ordered by position; each item links to its booking page
// with ?back=1 (prefill, UTM, display and embed parameters are forwarded). hide_landing_page_details=1 hides the
// header (BK-26); embeds post calendly.profile_page_viewed (BK-25). Unknown and deleted handles are 404 (BK-23). Like
// Calendly's profile card, the footer shows only "Cookie settings" (docs/research/calendly-live-capture.md item 20).
// A user's page is shown as one of their personas (lib/personas.ts): ?for={id} picks it, links without it show the
// default persona. Only the event types enabled for the persona are listed, under the names set for it; a warm persona
// gets the PersonaLanding card in the warm theme, a classic one the normal card with its greeting and note. Pages of a
// persona other than the default are never indexed.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmbedBeacon } from "@/components/booking/embed-beacon";
import { PERSONA_PARAM } from "@/components/booking/lib/friends";
import { firstNameOf, personaFor, personaLine, type Persona } from "@/components/booking/lib/personas";
import { bt } from "@/components/booking/lib/t";
import { landingForwardParams, withCarried } from "@/components/booking/lib/url-state";
import { type LandingData, loadLanding } from "@/components/booking/server/landing";
import { loadPersonas } from "@/components/booking/server/personas";
import { PUBLIC_TEXT_TRACKING } from "@/components/public/booking-card";
import { EventTypeList } from "@/components/public/event-type-list";
import { LandingEmpty, LandingEvents, LandingFooter } from "@/components/public/landing-layout";
import { PersonaLanding } from "@/components/public/persona-landing";
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

function personaParam(sp: Record<string, string | string[] | undefined>): string | undefined {
  const v = sp[PERSONA_PARAM];
  return Array.isArray(v) ? v[0] : v;
}

/** The persona a user page is shown as (null for teams, or a user without personas). */
async function personaOf(data: LandingData, sp: Record<string, string | string[] | undefined>): Promise<Persona | null> {
  if (data.kind !== "user") return null;
  return personaFor(await loadPersonas(data.userId), personaParam(sp));
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ handle }, sp] = await Promise.all([params, searchParams]);
  const data = await loadLanding(handle);
  if (!data) return { title: bt("states.notFoundTitle"), robots: { index: false, follow: false } };
  const persona = await personaOf(data, sp);
  const noindex = persona && !persona.isDefault ? { robots: { index: false, follow: false } } : {};
  if (persona?.style === "warm") {
    const title = personaLine("landingTitle", firstNameOf(data.name));
    const description = persona.note || persona.greeting || undefined;
    return { title, description, ...noindex, openGraph: { title, description } };
  }
  const description = persona?.note || data.welcomeMessage || undefined;
  return {
    title: data.name,
    description,
    ...noindex,
    openGraph: { title: data.name, description, images: data.avatarUrl ? [absoluteUrl(data.avatarUrl)] : undefined },
  };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ handle }, sp] = await Promise.all([params, searchParams]);
  const data = await loadLanding(handle);
  if (!data) notFound();
  const embed = embedDisplayParams(sp);
  const forward = landingForwardParams(sp);
  const persona = await personaOf(data, sp);
  const items = data.items.flatMap((e) => {
    const copy = persona && e.personas ? e.personas[persona.id] : undefined;
    if (persona && e.personas && !copy) return [];
    return [
      {
        id: e.id,
        name: copy?.name || e.name,
        color: e.color,
        description: copy?.description || e.description,
        href: withCarried(`/${encodeURIComponent(data.handle)}/${encodeURIComponent(e.slug)}?back=1`, forward),
      },
    ];
  });
  if (persona?.style === "warm" && !embed.embed) {
    return (
      <PublicPageShell tone="friends" showFooterLinks={false} hideGdprBanner={embed.hideGdprBanner} privacyUrl={data.privacyUrl}>
        <PersonaLanding host={{ name: data.name, avatarUrl: data.avatarUrl }} persona={persona} items={items} />
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
    >
      <PublicCard width="default" ribbon={data.ribbon} embed={embed.embed} className={cn("min-[1000px]:min-h-[706px]", PUBLIC_TEXT_TRACKING)}>
        <ProfileHeader name={data.name} heading={persona?.greeting} avatarUrl={data.avatarUrl} welcomeMessage={persona?.note || data.welcomeMessage} logoUrl={data.logoUrl} hidden={embed.hideLandingPageDetails} />
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
