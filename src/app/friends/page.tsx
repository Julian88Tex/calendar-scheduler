// /friends: the friends link landing page (lib/friends.ts): the owner's avatar, a personal note and their bookable
// event types under friendly names, in the warm friends theme (light or dark by the device setting). Never indexed.
// Each item opens /friends/{eventSlug}?back=1, the same booking flow as the public page in the friends voice.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FRIENDS_COPY, FRIENDS_PATH, firstNameOf, friendlyEventOf, friendsLine } from "@/components/booking/lib/friends";
import { loadFriendsLanding } from "@/components/booking/server/friends";
import { PUBLIC_TEXT_TRACKING } from "@/components/public/booking-card";
import { EventTypeList } from "@/components/public/event-type-list";
import { LandingEvents, LandingFooter } from "@/components/public/landing-layout";
import { PublicCard } from "@/components/public/public-card";
import { PublicFooterLinks } from "@/components/public/public-footer-links";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadFriendsLanding();
  const robots = { index: false, follow: false };
  if (!data) return { title: "This page isn't available", robots };
  const title = friendsLine("landingTitle", firstNameOf(data.name));
  return { title, description: FRIENDS_COPY.greeting, robots, openGraph: { title, description: FRIENDS_COPY.note } };
}

export default async function Page() {
  const data = await loadFriendsLanding();
  if (!data) notFound();
  const firstName = firstNameOf(data.name);
  const items = data.items.map((e) => {
    const friendly = friendlyEventOf(e.slug);
    return {
      id: e.id,
      name: friendly?.name ?? e.name,
      color: e.color,
      description: friendly?.blurb ?? e.description,
      href: `${FRIENDS_PATH}/${encodeURIComponent(e.slug)}?back=1`,
    };
  });
  return (
    <PublicPageShell tone="friends" showFooterLinks={false} privacyUrl={data.privacyUrl}>
      <PublicCard width="default" ribbon={false} className={cn("min-[1000px]:min-h-[640px]", PUBLIC_TEXT_TRACKING)}>
        <div className="flex flex-col items-center px-6 pt-10 pb-8 text-center min-[650px]:pb-12" data-testid="friends-hello">
          <Avatar src={data.avatarUrl} name={data.name} alt="" size={88} className="friends-avatar" />
          <h1 className="mt-6 text-[30px] leading-9 font-extrabold text-public-text">
            {FRIENDS_COPY.greeting}{" "}
            <span aria-hidden="true" className="friends-wave inline-block">
              👋
            </span>
          </h1>
          <p className="mt-4 max-w-[460px] text-[16px] leading-[26px] text-ink-2">{FRIENDS_COPY.note}</p>
          <p className="mt-5 text-[16px] leading-6 text-ink-2">
            {FRIENDS_COPY.signOff}
            <span className="friends-signature mt-1 block text-[22px] font-bold text-brand-strong">{firstName}</span>
          </p>
        </div>
        <LandingEvents>
          <h2 className="pb-5 text-center text-[13px] font-bold tracking-[0.08em] text-ink-2 uppercase">{FRIENDS_COPY.chooseHeading}</h2>
          {items.length > 0 ? (
            <EventTypeList items={items} aria-label={FRIENDS_COPY.chooseHeading} />
          ) : (
            <p className="border-t border-line px-6 py-16 text-center text-[16px] leading-6 text-ink-2">{friendsLine("empty", firstName)}</p>
          )}
        </LandingEvents>
        <LandingFooter>
          <PublicFooterLinks showPrivacyPolicy={false} />
        </LandingFooter>
      </PublicCard>
    </PublicPageShell>
  );
}
