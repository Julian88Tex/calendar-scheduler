// The details panel of the reschedule flow (SPEC CR-03 "the left panel showing a small 'Former Time' label above the
// old date and time struck through", BK-07, BK-09; walkthrough 11.7): the booking page's panel (brand header, host,
// event name, duration or the duration picker, locations) plus the Former Time block, and on the details step the new
// time and zone. Both times use the zone the invitee is looking at. Client component (duration picker).
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
import { HostHeaderView } from "@/components/booking/host-header";
import type { HostHeader } from "@/components/booking/lib/hosts";
import { locationRows } from "@/components/booking/lib/locations";
import { bt } from "@/components/booking/lib/t";
import { LocationGlyph } from "@/components/booking/location-icon";
import type { BrandHeaderView, EventView } from "@/components/booking/types";
import { Avatar } from "@/components/ui/avatar";
import { formatDuration } from "@/lib/time/format";
import { lt } from "./lib/t";

export type RescheduleSidePanelProps = {
  event: EventView;
  host: HostHeader;
  brandHeader: BrandHeaderView;
  duration: number;
  onDurationChange?: (minutes: number) => void;
  /** "10:00am - 10:30am, Wednesday, October 14, 2026" of the meeting being moved (null until the zone is known). */
  formerText: string | null;
  /** Details step: the new time and the zone name. */
  when?: { text: string; zoneName: string } | null;
  /** Calendar step: the zone name under the former time. */
  zoneName?: string | null;
  notice?: string | null;
  footer?: React.ReactNode;
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

export function RescheduleSidePanel({ event, host, brandHeader, duration, onDurationChange, formerText, when, zoneName, notice, footer }: RescheduleSidePanelProps) {
  const rows = locationRows(event.locations);
  return (
    <div className="relative flex min-h-full flex-col">
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
      <BookingSideSection>
        <HostHeaderView header={host} />
        <BookingEventTitle>{event.name}</BookingEventTitle>
        {notice && <p className="mt-3 text-[14px] leading-[21px] text-ink-2">{notice}</p>}
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
              <span className="whitespace-pre-line">{row.text}</span>
              {row.detail && <span className="block font-normal whitespace-pre-line">{row.detail}</span>}
            </BookingDetailRow>
          ))}
          {formerText && (
            <div className="flex flex-col gap-1 max-[999px]:items-center" data-testid="former-time">
              <span className="text-[11px] leading-4 font-bold tracking-[0.04em] text-ink-2 uppercase">{lt("reschedule.formerTime")}</span>
              <BookingDetailRow icon={<CalendarDays />}>
                <s className="decoration-ink-2" data-testid="former-when">
                  {formerText}
                </s>
              </BookingDetailRow>
            </div>
          )}
          {when && (
            <BookingDetailRow icon={<CalendarDays />}>
              <span data-testid="details-when">{when.text}</span>
            </BookingDetailRow>
          )}
          {(when?.zoneName ?? zoneName) && (
            <BookingDetailRow icon={<Globe />}>
              <span data-testid="details-zone">{when?.zoneName ?? zoneName}</span>
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
