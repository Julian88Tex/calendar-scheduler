// OWNER: foundation-ui.
//
// PersonaLanding: the landing card of a warm persona (/{handle}?for={id}, lib/personas.ts): the host's avatar, the
// persona's greeting, note and sign-off (balanced lines), its favorites as chips (even rows on phones), and the event
// types enabled for it under the names set on each event type. The words come from the host's Settings > Personas; empty ones are left out. Server and
// client safe.
import { firstNameOf, personaLine, type Persona } from "@/components/booking/lib/personas";
import { PUBLIC_TEXT_TRACKING } from "./booking-card";
import { EventTypeList, type EventTypeListItem } from "./event-type-list";
import { LandingEvents, LandingFooter } from "./landing-layout";
import { PublicCard } from "./public-card";
import { PublicFooterLinks } from "./public-footer-links";
import { Avatar } from "@/components/ui/avatar";

/**
 * Where the chip rows end on phones, so rows come out even (four chips are two and two, five are three and two) rather
 * than a full row with one chip left over. Indexes of the last chip of every row but the last.
 */
export function balancedRowEnds(count: number, maxPerRow: number): Set<number> {
  const rows = Math.ceil(count / maxPerRow);
  const ends = new Set<number>();
  let at = 0;
  for (let r = 0; r < rows - 1; r++) {
    at += Math.ceil((count - at) / (rows - r));
    ends.add(at - 1);
  }
  return ends;
}

export function PersonaLanding({ host, persona, items }: { host: { name: string; avatarUrl: string | null }; persona: Persona; items: EventTypeListItem[] }) {
  const firstName = firstNameOf(host.name);
  const rowEnds = balancedRowEnds(persona.favorites.length, 3);
  return (
    <PublicCard width="default" ribbon={false} className={PUBLIC_TEXT_TRACKING}>
      <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center" data-testid="persona-hello">
        <Avatar src={host.avatarUrl} name={host.name} alt="" size={64} className="friends-avatar" />
        <h1 className="mt-4 text-[26px] leading-8 font-extrabold text-balance text-public-text">
          {persona.greeting || host.name}{" "}
          <span aria-hidden="true" className="friends-wave inline-block">
            👋
          </span>
        </h1>
        {persona.note && <p className="mt-2 max-w-[480px] text-[15px] leading-6 text-balance text-ink-2">{persona.note}</p>}
        {persona.signOff && (
          <p className="mt-2 text-[15px] leading-6 text-balance text-ink-2">
            {persona.signOff} <span className="friends-signature text-[18px] font-bold text-brand-strong">{firstName}</span>
          </p>
        )}
        {persona.favorites.length > 0 && (
          <div className="mt-4 flex flex-col items-center gap-2" data-testid="persona-favorites">
            {persona.favoritesHeading && <h2 className="text-[12px] font-bold tracking-[0.08em] text-ink-2 uppercase">{persona.favoritesHeading}</h2>}
            <ul className="flex flex-wrap justify-center gap-x-1.5">
              {persona.favorites.map((c, i) => [
                <li key={c.label} className="friends-chip my-[3px] rounded-full border border-line bg-public-bg px-3 py-1 text-[13px] leading-5 text-public-text">
                  {c.emoji && <span aria-hidden="true">{c.emoji} </span>}
                  {c.label}
                </li>,
                rowEnds.has(i) && <li key={`${c.label}-break`} role="presentation" aria-hidden="true" className="h-0 basis-full min-[600px]:hidden" />,
              ])}
            </ul>
          </div>
        )}
      </div>
      <LandingEvents>
        {persona.chooseHeading && <h2 className="pb-4 text-center text-[12px] font-bold tracking-[0.08em] text-ink-2 uppercase">{persona.chooseHeading}</h2>}
        {items.length > 0 ? (
          <EventTypeList items={items} aria-label={persona.chooseHeading || persona.name} />
        ) : (
          <p className="border-t border-line px-6 py-12 text-center text-[16px] leading-6 text-ink-2">{personaLine("empty", firstName)}</p>
        )}
      </LandingEvents>
      <LandingFooter>
        <PublicFooterLinks showPrivacyPolicy={false} />
      </LandingFooter>
    </PublicCard>
  );
}
