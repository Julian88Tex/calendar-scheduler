// Left panel of the voter page (SPEC MP-07; research B5.1): the owner's logo, the host avatar(s) and names ("{Name} and
// {n} others"), the "Meeting poll" label, the title (28px bold), clock + duration ("Varies" when durations differ),
// the location row (pre-booking display rules), "Voting closes {date time}" when a deadline exists, the description,
// and the footer links (Cookie settings, Privacy Policy). Server and client safe.
import { CalendarDays, Clock, Globe } from "lucide-react";
import { HostHeaderView } from "@/components/booking/host-header";
import type { HostHeader } from "@/components/booking/lib/hosts";
import { LocationGlyph } from "@/components/booking/location-icon";
import { BookingBrandHeader, BookingDetailList, BookingDetailRow, BookingEventTitle, BookingSideFooter, BookingSideSection } from "@/components/public/booking-card";
import { PublicFooterLinks } from "@/components/public/public-footer-links";
import type { PollHostView, PollLocationView } from "@/lib/polls/types";
import { formatDateLong, formatTime } from "@/lib/time/format";
import { durationLabel, hostNamesLabel } from "../lib/format";
import { pt } from "../lib/t";

export function hostHeaderFor(hosts: readonly PollHostView[]): HostHeader {
  const people = hosts.map((h) => ({ id: h.userId, name: h.name, avatarUrl: h.avatarUrl }));
  if (people.length <= 1) return { variant: "single", person: people[0] ?? { id: "none", name: "", avatarUrl: null } };
  return { variant: "stack", people, extra: 0, label: hostNamesLabel(people.map((p) => p.name)) };
}

export function LocationLine({ location }: { location: PollLocationView }) {
  if (!location || (!location.text && !location.isConference)) return null;
  const icon = location.isConference ? "video" : location.kind === "inbound_call" ? "phone" : location.kind === "custom" ? "custom" : "pin";
  return (
    <BookingDetailRow icon={<LocationGlyph icon={icon} />}>
      <span className="whitespace-pre-line" data-testid="poll-location">
        {location.text}
      </span>
      {location.additionalInfo && !location.isConference && <span className="block font-normal whitespace-pre-line">{location.additionalInfo}</span>}
    </BookingDetailRow>
  );
}

export type VoterSidePanelProps = {
  hosts: PollHostView[];
  title: string;
  durationMinutes: number | null;
  location: PollLocationView;
  deadline: string | null;
  descriptionHtml: string | null;
  zone: string;
  hour12: boolean;
  /** Fixed time zone mode: the zone everyone sees. */
  fixedZoneName: string | null;
  logoUrl: string | null;
  operatorEmail: string | null;
  privacyUrl: string | null;
  showFooter: boolean;
};

export function VoterSidePanel(p: VoterSidePanelProps) {
  return (
    <div className="relative flex min-h-full flex-col">
      {p.logoUrl && (
        <BookingBrandHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.logoUrl} alt="" className="max-h-[120px] max-w-[200px] object-contain" />
        </BookingBrandHeader>
      )}
      <BookingSideSection>
        <HostHeaderView header={hostHeaderFor(p.hosts)} />
        <p className="mt-3 text-eyebrow text-ink-2" data-testid="poll-label">
          {pt("voter.label")}
        </p>
        <BookingEventTitle className="mt-1">{p.title}</BookingEventTitle>
        <BookingDetailList>
          <BookingDetailRow icon={<Clock />}>{durationLabel(p.durationMinutes)}</BookingDetailRow>
          <LocationLine location={p.location} />
          {p.deadline && (
            <BookingDetailRow icon={<CalendarDays />}>
              <span data-testid="poll-deadline">
                {pt("voter.votingCloses", { when: `${formatDateLong(p.deadline, p.zone)}, ${formatTime(p.deadline, p.zone, "en", p.hour12)}` })}
              </span>
            </BookingDetailRow>
          )}
          {p.fixedZoneName && <BookingDetailRow icon={<Globe />}>{p.fixedZoneName}</BookingDetailRow>}
        </BookingDetailList>
        {p.descriptionHtml && (
          <div
            className="booking-description mt-6 text-left text-[14px] leading-[22px] break-words text-public-text max-[999px]:text-center [&_a]:text-brand-strong [&_a]:underline [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc"
            // Sanitized by polls-core (sanitizeRichText) before it reaches the page.
            dangerouslySetInnerHTML={{ __html: p.descriptionHtml }}
          />
        )}
      </BookingSideSection>
      {p.showFooter && (
        <BookingSideFooter>
          <PublicFooterLinks operatorEmail={p.operatorEmail} privacyUrl={p.privacyUrl} showPrivacyPolicy={Boolean(p.privacyUrl)} className="max-[999px]:justify-center" />
        </BookingSideFooter>
      )}
    </div>
  );
}
