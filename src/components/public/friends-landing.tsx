// OWNER: foundation-ui.
//
// FriendsLanding: the /{handle}?friends=1 landing card of friends mode (lib/friends.ts): the host's avatar, greeting,
// note and sign-off, their favorite ways to hang as chips, and their event types under friendly names. The words come
// from the host's Settings > Friends mode. Server and client safe.
import { firstNameOf, friendlyEventOf, friendsLine, type FriendsContent } from "@/components/booking/lib/friends";
import type { LandingData } from "@/components/booking/server/landing";
import { PUBLIC_TEXT_TRACKING } from "./booking-card";
import { EventTypeList } from "./event-type-list";
import { LandingEvents, LandingFooter } from "./landing-layout";
import { PublicCard } from "./public-card";
import { PublicFooterLinks } from "./public-footer-links";
import { Avatar } from "@/components/ui/avatar";

export function FriendsLanding({ data, content, hrefOf }: { data: LandingData; content: FriendsContent; hrefOf: (slug: string) => string }) {
  const firstName = firstNameOf(data.name);
  const items = data.items.map((e) => {
    const friendly = friendlyEventOf(content, e.slug);
    return { id: e.id, name: friendly?.name || e.name, color: e.color, description: friendly?.blurb || e.description, href: hrefOf(e.slug) };
  });
  return (
    <PublicCard width="default" ribbon={false} className={PUBLIC_TEXT_TRACKING}>
      <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center" data-testid="friends-hello">
        <Avatar src={data.avatarUrl} name={data.name} alt="" size={64} className="friends-avatar" />
        <h1 className="mt-4 text-[26px] leading-8 font-extrabold text-public-text">
          {content.greeting}{" "}
          <span aria-hidden="true" className="friends-wave inline-block">
            👋
          </span>
        </h1>
        <p className="mt-2 max-w-[480px] text-[15px] leading-6 text-ink-2">{content.note}</p>
        <p className="mt-2 text-[15px] leading-6 text-ink-2">
          {content.signOff} <span className="friends-signature text-[18px] font-bold text-brand-strong">{firstName}</span>
        </p>
        {content.favorites.length > 0 && (
          <div className="mt-4 flex flex-col items-center gap-2" data-testid="friends-favorites">
            <h2 className="text-[12px] font-bold tracking-[0.08em] text-ink-2 uppercase">{content.favoritesHeading}</h2>
            <ul className="flex flex-wrap justify-center gap-1.5">
              {content.favorites.map((c) => (
                <li key={c.label} className="friends-chip rounded-full border border-line bg-public-bg px-3 py-1 text-[13px] leading-5 text-public-text">
                  {c.emoji && <span aria-hidden="true">{c.emoji} </span>}
                  {c.label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <LandingEvents>
        <h2 className="pb-4 text-center text-[12px] font-bold tracking-[0.08em] text-ink-2 uppercase">{content.chooseHeading}</h2>
        {items.length > 0 ? (
          <EventTypeList items={items} aria-label={content.chooseHeading} />
        ) : (
          <p className="border-t border-line px-6 py-12 text-center text-[16px] leading-6 text-ink-2">{friendsLine("empty", firstName)}</p>
        )}
      </LandingEvents>
      <LandingFooter>
        <PublicFooterLinks showPrivacyPolicy={false} />
      </LandingFooter>
    </PublicCard>
  );
}
