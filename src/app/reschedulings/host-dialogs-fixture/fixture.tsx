// E2E fixture of the host meeting dialogs (see page.tsx): one card per meeting with the dialogs mounted exactly as the
// Meetings page mounts them. Client component.
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { HostCancelDialog, MarkNoShowButton, MeetingBrief, NotesEditor, RescheduleChoiceDialog, type HostMeetingSummary } from "@/components/lifecycle";
import { Button } from "@/components/ui/button";

export function HostDialogsFixture({ meetings, now }: { meetings: HostMeetingSummary[]; now: number }) {
  return (
    <ul className="flex flex-col gap-4">
      {meetings.map((m) => (
        <MeetingCard key={m.scheduledEventId} meeting={m} now={now} />
      ))}
    </ul>
  );
}

function MeetingCard({ meeting, now }: { meeting: HostMeetingSummary; now: number }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"cancel" | "reschedule" | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const active = meeting.status === "active";
  return (
    <li className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4" data-testid={`fixture-meeting-${meeting.scheduledEventId}`} aria-label={meeting.eventName}>
      <MeetingBrief meeting={meeting} />
      <p className="text-body-sm text-ink-2">{active ? "Active" : "Canceled"}</p>
      {active && (
        <div className="flex flex-wrap gap-2">
          <Button ref={opener} variant="secondary" onClick={() => setDialog("reschedule")}>
            Reschedule
          </Button>
          <Button variant="secondary" onClick={() => setDialog("cancel")}>
            Cancel
          </Button>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {meeting.invitees.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3">
            <span className="text-body-md font-semibold text-ink">{i.name}</span>
            <MarkNoShowButton inviteeId={i.id} inviteeName={i.name} noShow={i.noShow} meetingStart={meeting.start} canceled={i.status !== "active"} now={now} size="sm" />
          </li>
        ))}
      </ul>
      <NotesEditor scheduledEventId={meeting.scheduledEventId} initialHtml={meeting.notesHtml} />
      <HostCancelDialog open={dialog === "cancel"} onOpenChange={(v) => setDialog(v ? "cancel" : null)} meeting={meeting} now={now} onCanceled={() => router.refresh()} />
      <RescheduleChoiceDialog
        open={dialog === "reschedule"}
        onOpenChange={(v) => setDialog(v ? "reschedule" : null)}
        meeting={meeting}
        now={now}
        returnFocusRef={opener}
        onRescheduled={() => router.refresh()}
        onRequested={() => router.refresh()}
      />
    </li>
  );
}
