// The event summary at the top of the host dialogs (SPEC CR-06 "Cancel event modal with the event summary", CR-07,
// CR-08): the event color dot and name, the time range and date in the host's zone and time format, the zone name, and
// the invitee (or "{n} invitees"). Server and client safe.
import { formatMeetingWhen } from "@/lib/time/format";
import { friendlyZoneName } from "@/lib/time/zones";
import { lt } from "./lib/t";
import type { HostMeetingSummary } from "./types";

export function meetingWhen(meeting: Pick<HostMeetingSummary, "start" | "end" | "timeZone" | "hour12">): string {
  return formatMeetingWhen(meeting.start, meeting.end, meeting.timeZone, "en-US", meeting.hour12);
}

export function MeetingBrief({ meeting }: { meeting: HostMeetingSummary }) {
  const active = meeting.invitees.filter((i) => i.status === "active");
  const people = active.length > 0 ? active : meeting.invitees;
  const who = people.length === 1 ? people[0]!.name : people.length > 1 ? lt("host.invitees", { count: people.length }) : null;
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line px-4 py-3" data-testid="meeting-brief">
      <span aria-hidden="true" className="mt-1 size-3.5 shrink-0 rounded-full" style={{ backgroundColor: meeting.color }} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-[15px] leading-5 font-bold break-words text-ink">{meeting.eventName}</p>
        <p className="text-[14px] leading-5 text-ink-2">{meetingWhen(meeting)}</p>
        <p className="text-[13px] leading-5 text-ink-2">{friendlyZoneName(meeting.timeZone)}</p>
        {who && <p className="text-[14px] leading-5 font-semibold break-words text-ink">{who}</p>}
      </div>
    </div>
  );
}
