// The details panel of the cancel and reschedule state pages (SPEC CR-02 "left: event details (name, host, time, zone,
// location)", BK-03 look): the host's logo or avatar with the divider, the host header, the event name, then the
// duration, the meeting's time in the invitee's zone, the zone name and the booked location. A canceled meeting is
// struck through (with an "s" element, so assistive technology hears it is no longer current). Server and client safe.
import { CalendarDays, Clock, Globe } from "lucide-react";
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
import { LocationGlyph } from "@/components/booking/location-icon";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/time/format";
import type { MeetingSummaryView } from "./types";

function Struck({ on, children }: { on: boolean; children: React.ReactNode }) {
  return on ? <s className="decoration-ink-2">{children}</s> : <>{children}</>;
}

export type MeetingSummaryPanelProps = {
  summary: MeetingSummaryView;
  /** Strike the meeting through (canceled). Defaults to summary.canceled. */
  struck?: boolean;
  footer?: React.ReactNode;
};

export function MeetingSummaryPanel({ summary: s, struck, footer }: MeetingSummaryPanelProps) {
  const strike = struck ?? s.canceled;
  return (
    <div className="relative flex min-h-full flex-col" data-testid="meeting-summary">
      {s.brandHeader && (
        <BookingBrandHeader>
          {s.brandHeader.kind === "logo" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.brandHeader.src} alt="" className="max-h-[120px] max-w-[200px] object-contain" />
          ) : (
            <Avatar src={s.brandHeader.src} name={s.brandHeader.name} alt="" size={120} />
          )}
        </BookingBrandHeader>
      )}
      <BookingSideSection>
        <HostHeaderView header={s.host} />
        <BookingEventTitle className={cn(strike && "line-through decoration-ink-2")}>{s.eventName}</BookingEventTitle>
        <BookingDetailList>
          <BookingDetailRow icon={<Clock />}>
            <Struck on={strike}>{formatDuration(s.durationMinutes)}</Struck>
          </BookingDetailRow>
          <BookingDetailRow icon={<CalendarDays />}>
            <span data-testid="summary-when">
              <Struck on={strike}>{s.whenText}</Struck>
            </span>
          </BookingDetailRow>
          <BookingDetailRow icon={<Globe />}>
            <span data-testid="summary-zone">{s.zoneName}</span>
          </BookingDetailRow>
          {s.location && (
            <BookingDetailRow icon={<LocationGlyph icon={s.location.icon} />}>
              <span className="whitespace-pre-line" data-testid="summary-location">
                <Struck on={strike}>{s.location.text}</Struck>
              </span>
              {s.location.detail && !strike && <span className="block font-normal break-all whitespace-pre-line">{s.location.detail}</span>}
            </BookingDetailRow>
          )}
        </BookingDetailList>
      </BookingSideSection>
      {footer && <BookingSideFooter>{footer}</BookingSideFooter>}
    </div>
  );
}
