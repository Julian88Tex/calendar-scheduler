// The details panel of the booking card (SPEC BK-03, BK-07, BK-09; owner reference .reference/booking-30min.png and
// docs/research/calendly-live-capture.md items 1, 2, 11, 16 and 20): the optional back button at the top-left (back=1
// on the calendar step, always on the details step), the branding logo or the large host avatar with a divider, the
// host header, the event name, the detail rows (duration or the duration picker, location rows, locked time zone, and
// on the details step the chosen time and zone), the description and the footer links. Phones show a short header bar
// (back button and a 40px logo on one row); on the details step they drop the host header and set the rows on the 15px
// page gutter, like Calendly. Client component (duration picker).
"use client";

import { ChevronDown, Clock } from "lucide-react";
import type * as React from "react";
import {
  BookingBrandHeader,
  BookingDetailList,
  BookingDetailRow,
  BookingEventTitle,
  BookingSideFooter,
  BookingSideSection,
} from "@/components/public/booking-card";
import { BackButton } from "@/components/public/back-button";
import { CalendarDayIcon, GlobeIcon } from "@/components/ui/booking-icons";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/time/format";
import { HostHeaderView } from "./host-header";
import type { HostHeader } from "./lib/hosts";
import { locationRows } from "./lib/locations";
import { bt } from "./lib/t";
import { LocationGlyph } from "./location-icon";
import type { BrandHeaderView, EventView } from "./types";

export type EventDetailsPanelProps = {
  event: EventView;
  host: HostHeader;
  brandHeader: BrandHeaderView;
  duration: number;
  /** Calendar step with several durations: the clock row becomes a picker (BK-07). */
  onDurationChange?: (minutes: number) => void;
  /** Details step: "10:00am - 10:30am, Wednesday, October 14, 2026" and the zone name (BK-09). */
  when?: { text: string; zoneName: string } | null;
  /** Locked time zone name (SCH-22), shown with a globe. */
  lockedZoneName?: string | null;
  back?: { href?: string; onClick?: () => void; label: string } | null;
  footer?: React.ReactNode;
  /** Classes for the footer block (the booking flow hides it on phones, where the card shows its own footer). */
  footerClassName?: string;
  /** Which step the panel belongs to (phones lay the details step out differently). Default "calendar". */
  step?: "calendar" | "details";
  /** Shown instead of an empty event name in previews of new event types. */
  namePlaceholder?: string;
};

function DurationPicker({ value, options, onChange }: { value: number; options: number[]; onChange: (v: number) => void }) {
  return (
    <span className="relative inline-flex items-center">
      <select
        aria-label={bt("page.duration")}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cursor-pointer appearance-none rounded-[4px] bg-transparent py-0 pr-6 pl-0 text-[14px] leading-[21px] font-bold text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {options.map((d) => (
          <option key={d} value={d}>
            {formatDuration(d)}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-0 size-4 text-ink-2" />
    </span>
  );
}

/** The logo or the host avatar: about 120px in the panel header, 40px in the phone header bar. */
function BrandMark({ brandHeader }: { brandHeader: NonNullable<BrandHeaderView> }) {
  if (brandHeader.kind === "logo") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={brandHeader.src} alt="" className="max-h-[120px] max-w-[200px] object-contain max-[599px]:max-h-10 max-[599px]:max-w-[160px]" />;
  }
  return (
    <>
      <Avatar src={brandHeader.src} name={brandHeader.name} alt="" size={120} className="max-[599px]:hidden" />
      <Avatar src={brandHeader.src} name={brandHeader.name} alt="" size={40} className="min-[600px]:hidden" />
    </>
  );
}

export function EventDetailsPanel({
  event,
  host,
  brandHeader,
  duration,
  onDurationChange,
  when,
  lockedZoneName,
  back,
  footer,
  footerClassName,
  step = "calendar",
  namePlaceholder,
}: EventDetailsPanelProps) {
  const rows = locationRows(event.locations);
  const details = step === "details";
  return (
    <div className="relative flex min-h-full flex-col">
      {back && (
        <div className="absolute top-[25px] left-[30px] z-10 max-[599px]:top-[17px] max-[599px]:left-[17px]">
          <BackButton href={back.href} onClick={back.onClick} label={back.label} />
        </div>
      )}
      {brandHeader && (
        // Phones, details step: the divider under the header bar is inset 25px on both sides (observed).
        <BookingBrandHeader className={cn(details && "max-[599px]:mx-[25px] max-[599px]:px-0")}>
          <BrandMark brandHeader={brandHeader} />
        </BookingBrandHeader>
      )}
      <BookingSideSection
        className={cn(
          !brandHeader && back && "pt-[84px]",
          details ? "max-[599px]:px-[15px] max-[599px]:pt-[23px] max-[599px]:pb-[46px]" : "max-[599px]:pb-[44px]",
        )}
      >
        <HostHeaderView header={host} className={cn(details && "max-[599px]:hidden")} />
        <BookingEventTitle>{event.name || namePlaceholder}</BookingEventTitle>
        <BookingDetailList className={cn(details ? "max-[599px]:mt-6 max-[599px]:gap-[17px] max-[599px]:self-stretch" : "max-[599px]:gap-4 max-[599px]:px-6")}>
          <BookingDetailRow icon={<Clock />}>
            {onDurationChange && event.durations.length > 1 ? (
              <DurationPicker value={duration} options={event.durations} onChange={onDurationChange} />
            ) : (
              formatDuration(duration)
            )}
          </BookingDetailRow>
          {rows.map((row) => (
            <BookingDetailRow key={row.key} icon={<LocationGlyph icon={row.icon} />}>
              <span className="whitespace-pre-line" data-testid="location-row">
                {row.text}
              </span>
              {row.detail && <span className="block font-normal whitespace-pre-line">{row.detail}</span>}
            </BookingDetailRow>
          ))}
          {/* Calendly sets these two icons 1.5px right of the clock, and the calendar in the text's #476788. */}
          {when && (
            <BookingDetailRow icon={<CalendarDayIcon className="translate-x-[1.5px]" />} iconClassName="text-ink-2" className="gap-[11px]">
              <span data-testid="details-when">{when.text}</span>
            </BookingDetailRow>
          )}
          {(when || lockedZoneName) && (
            <BookingDetailRow icon={<GlobeIcon className="translate-x-[1.5px]" />} className="gap-[11px]">
              <span data-testid="details-zone">{when?.zoneName ?? lockedZoneName}</span>
            </BookingDetailRow>
          )}
        </BookingDetailList>
        {event.descriptionHtml ? (
          <div
            className="booking-description mt-6 text-left text-[14px] leading-[22px] break-words text-public-text max-[999px]:text-center [&_a]:text-brand-strong [&_a]:underline [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: event.descriptionHtml }}
          />
        ) : event.descriptionText ? (
          <p className="mt-6 text-left text-[14px] leading-[22px] break-words whitespace-pre-line text-public-text max-[999px]:text-center">{event.descriptionText}</p>
        ) : null}
      </BookingSideSection>
      {footer && <BookingSideFooter className={footerClassName}>{footer}</BookingSideFooter>}
    </div>
  );
}
