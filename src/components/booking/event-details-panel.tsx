// The details panel of the booking card (SPEC BK-03, BK-07, BK-09; owner reference .reference/booking-30min.png): the
// optional back button (back=1), the branding logo or the large host avatar with a divider, the host header, the event
// name, the detail rows (duration or the duration picker, location rows, locked time zone, and on the details step the
// chosen time and zone), the description and the footer links. Client component (duration picker).
"use client";

import { CalendarDays, ChevronDown, Clock, Globe } from "lucide-react";
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
import { Avatar } from "@/components/ui/avatar";
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
        className="cursor-pointer appearance-none rounded-[4px] bg-transparent py-0 pr-6 pl-0 text-[14px] leading-[21px] font-semibold text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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

export function EventDetailsPanel({ event, host, brandHeader, duration, onDurationChange, when, lockedZoneName, back, footer, namePlaceholder }: EventDetailsPanelProps) {
  const rows = locationRows(event.locations);
  return (
    <div className="relative flex min-h-full flex-col">
      {back && (
        <div className="absolute top-[26px] left-[26px] z-10 max-[599px]:top-4 max-[599px]:left-4">
          <BackButton href={back.href} onClick={back.onClick} label={back.label} />
        </div>
      )}
      {brandHeader && (
        <BookingBrandHeader>
          {brandHeader.kind === "logo" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandHeader.src} alt="" className="max-h-[120px] max-w-[200px] object-contain" />
          ) : (
            <Avatar src={brandHeader.src} name={brandHeader.name} alt="" size={120} />
          )}
        </BookingBrandHeader>
      )}
      <BookingSideSection className={!brandHeader && back ? "pt-[84px]" : undefined}>
        <HostHeaderView header={host} />
        <BookingEventTitle>{event.name || namePlaceholder}</BookingEventTitle>
        <BookingDetailList>
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
          {when && (
            <BookingDetailRow icon={<CalendarDays />}>
              <span data-testid="details-when">{when.text}</span>
            </BookingDetailRow>
          )}
          {(when || lockedZoneName) && (
            <BookingDetailRow icon={<Globe />}>
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
      {footer && <BookingSideFooter>{footer}</BookingSideFooter>}
    </div>
  );
}
