// One meeting row of the Meetings list (SPEC MT-05, MT-13; walkthrough 10.1): the event color dot and the time range
// (struck through when canceled), the invitee name in bold (or "{n} invitees" with "{n} of {limit} spots filled" for
// group slots) with the "Poll", "Canceled" or "Rescheduled" badges, "Event type {name}", "1 host | 0 non-hosts", and
// the "Details" toggle. On desktop the details expand inline under the row; on phones they open in a full-screen
// sheet. Client component.
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { fill, MEETINGS_COPY as C } from "@/lib/meetings/copy";
import type { MeetingView } from "@/lib/meetings/types";
import { MeetingDetails, type MeetingDetailsProps } from "./meeting-details";

export type MeetingRowProps = Omit<MeetingDetailsProps, "meeting" | "compact"> & {
  meeting: MeetingView;
  expanded: boolean;
  onToggle: (open: boolean) => void;
  /** Phones: details in a sheet. */
  phone: boolean;
};

export function MeetingRow({ meeting, expanded, onToggle, phone, ...details }: MeetingRowProps) {
  const canceled = meeting.status === "canceled";
  const panelId = `meeting-${meeting.id}-details`;
  return (
    <li className="border-b border-line last:border-b-0" data-testid={`meeting-row-${meeting.id}`} data-meeting-id={meeting.id}>
      <div className={cn("flex items-start gap-3 px-4 py-4 sm:gap-4 sm:px-6", expanded && !phone && "md:bg-canvas")}>
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex shrink-0 items-center gap-3 sm:w-48 sm:pt-0.5">
            <span aria-hidden="true" className="size-4 shrink-0 rounded-full" style={{ backgroundColor: meeting.color }} />
            <span className={cn("text-body-md whitespace-nowrap text-ink", canceled && "text-ink-2 line-through")}>
              {canceled && <span className="sr-only">{C.row.canceled}: </span>}
              {meeting.timeRange}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pl-7 sm:pl-0">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[15px] leading-5 font-bold break-words text-ink">{meeting.title}</span>
              {meeting.isPoll && <Badge variant="info" size="sm">{C.row.poll}</Badge>}
              {meeting.rescheduled ? (
                <Badge variant="neutral" size="sm">
                  {C.row.rescheduled}
                </Badge>
              ) : (
                canceled && (
                  <Badge variant="danger" size="sm">
                    {C.row.canceled}
                  </Badge>
                )
              )}
            </p>
            <p className="text-body-md break-words text-ink-2">
              {C.row.eventType} <span className="font-semibold text-ink">{meeting.eventName}</span>
            </p>
            {meeting.spotsLabel && <p className="text-body-sm text-ink-2">{meeting.spotsLabel}</p>}
            <p className="text-body-sm text-ink-2 md:hidden">{meeting.hostsLabel}</p>
          </div>
          <p className="hidden shrink-0 pt-0.5 text-body-sm whitespace-nowrap text-ink-2 md:block">{meeting.hostsLabel}</p>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={phone ? undefined : panelId}
          aria-label={fill(C.row.detailsLabel, { title: `${meeting.title}, ${meeting.eventName}, ${meeting.timeRange}` })}
          onClick={() => onToggle(!expanded)}
          className="-mr-2 inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full px-3 text-[14px] font-semibold text-primary-text hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          data-testid="meeting-details-toggle"
        >
          {expanded && !phone ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
          {C.row.details}
        </button>
      </div>
      {expanded && !phone && (
        // Below md the details live in the sheet. Until the media query is known (server render and hydration) the
        // inline panel is hidden there by CSS, so a deep link on a phone does not flash the inline details first.
        <div
          id={panelId}
          role="region"
          tabIndex={-1}
          aria-label={fill(C.row.detailsLabel, { title: meeting.title })}
          className="border-t border-line bg-white px-4 py-5 outline-none max-md:hidden sm:px-6"
          data-testid="meeting-details-panel"
        >
          <MeetingDetails meeting={meeting} {...details} />
        </div>
      )}
      {phone && (
        <Sheet
          open={expanded}
          onOpenChange={onToggle}
          side="right"
          size="md"
          className="w-full"
          title={meeting.title}
          description={`${meeting.when}, ${meeting.eventName}`}
        >
          <MeetingDetails meeting={meeting} {...details} compact />
        </Sheet>
      )}
    </li>
  );
}
