// The expanded details of a meeting (SPEC MT-06, MT-07, MT-13, CR-06 to CR-08, CR-11, CR-13, CR-14; walkthrough
// 10.1): two columns on desktop, one on phones. Left: "Reschedule" and "Cancel" (active meetings that have not ended,
// hosts and editors only), "Mark as no-show" once the meeting started, then the links "Edit Event Type", "Filter by
// Event Type" and "Schedule Invitee Again" (canceled or past meetings). Right: status lines (canceled by, rescheduled
// to or from, calendar problems), EMAIL, LOCATION (with "Join now" and "Retry"), INVITEE TIME ZONE, QUESTIONS,
// GUESTS, TRACKING, MEETING HOST, meeting notes and the "Created ... by ..." footer. Blocks without data are left out.
// The dialogs are lifecycle-ui's (HostCancelDialog, RescheduleChoiceDialog, MarkNoShowButton, NotesEditor). Client
// component.
"use client";

import { CalendarClock, ExternalLink, Filter, MapPin, Pencil, Phone, RotateCcw, Trash2, Video } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import type * as React from "react";
import { HostCancelDialog, MarkNoShowButton, NotesEditor, RescheduleChoiceDialog } from "@/components/lifecycle";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { retryMeetingProvisioningAction } from "@/lib/meetings/actions";
import { MEETINGS_COPY as C } from "@/lib/meetings/copy";
import type { MeetingLocationView, MeetingNotice, MeetingPersonView, MeetingView } from "@/lib/meetings/types";

export type MeetingDetailsProps = {
  meeting: MeetingView;
  /** Business clock (ms), null while hydrating. */
  now: number | null;
  /** "Filter by Event Type". */
  onFilterByEventType: (eventTypeId: string) => void;
  /** After a cancel or a "Share new times to meet": the meeting leaves the list. */
  onCanceled: () => void;
  /** After "Reschedule meeting now": show the new meeting. */
  onRescheduled: (scheduledEventId: string) => void;
  /** Open the other meeting of a reschedule. */
  onOpenMeeting: (scheduledEventId: string) => void;
  /** Phones: one column. */
  compact?: boolean;
};

function Block({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5" data-testid={testId}>
      <h3 className="text-eyebrow text-ink-2">{label}</h3>
      <div className="min-w-0 text-body-md text-ink">{children}</div>
    </section>
  );
}

const NOTICE_TONES: Record<MeetingNotice["tone"], string> = {
  neutral: "border-line bg-canvas text-ink",
  info: "border-primary-soft-2 bg-info-soft text-ink",
  warning: "border-warning-soft bg-warning-soft text-warning-text",
  danger: "border-danger-soft bg-danger-soft text-danger-text",
};

function Notice({ notice, onOpenMeeting }: { notice: MeetingNotice; onOpenMeeting: (id: string) => void }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-[var(--radius-card)] border px-3 py-2.5 text-body-md", NOTICE_TONES[notice.tone])} data-testid={`notice-${notice.kind}`}>
      <p className="font-semibold break-words">{notice.text}</p>
      {notice.details.map((d) => (
        <p key={d} className="break-words whitespace-pre-line">
          {d}
        </p>
      ))}
      {notice.link && (
        <Button variant="tertiary" size="sm" className="-ml-3 self-start" onClick={() => onOpenMeeting(notice.link!.eventId)}>
          {notice.link.label}
        </Button>
      )}
    </div>
  );
}

const LOCATION_ICONS = { video: Video, pin: MapPin, phone: Phone, custom: MapPin } as const;

function LocationBlock({ meetingId, location, canRetry }: { meetingId: string; location: MeetingLocationView; canRetry: boolean }) {
  const Icon = LOCATION_ICONS[location.icon];
  const [pending, start] = useTransition();
  const retry = () =>
    start(async () => {
      try {
        const r = await retryMeetingProvisioningAction({ scheduledEventId: meetingId });
        if (r.ok) toast.success(C.details.retried);
        else toast.error(r.error.message);
      } catch {
        toast.error(C.errors.network);
      }
    });
  return (
    <Block label={C.details.location} testId="meeting-location">
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-2" />
        <div className="flex min-w-0 flex-col gap-0.5">
          {location.href ? (
            <a href={location.href} target={location.href.startsWith("tel:") ? undefined : "_blank"} rel="noopener noreferrer" className="font-semibold break-words text-primary-text hover:underline">
              {location.text}
            </a>
          ) : (
            <p className="font-semibold break-words whitespace-pre-line">{location.text}</p>
          )}
          {location.detail && <p className="break-all text-ink-2 [overflow-wrap:anywhere]">{location.detail}</p>}
        </div>
      </div>
      {location.joinHref && (
        <a href={location.joinHref} target="_blank" rel="noopener noreferrer" className={cn(buttonClassName({ variant: "primary", size: "sm" }), "mt-2")}>
          <Video aria-hidden="true" />
          {C.details.joinNow}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      {location.problem && (
        <div className="mt-2 flex flex-col gap-2 rounded-[var(--radius-card)] border border-warning-soft bg-warning-soft px-3 py-2 text-warning-text" role="status">
          <p className="break-words">{location.problem}</p>
          {canRetry && (
            <Button variant="secondary" size="sm" className="self-start" loading={pending} onClick={retry} leftIcon={<RotateCcw aria-hidden="true" />}>
              {C.details.retry}
            </Button>
          )}
        </div>
      )}
    </Block>
  );
}

function PersonBlocks({ person }: { person: MeetingPersonView }) {
  return (
    <>
      {person.timeZoneLabel && <Block label={C.details.inviteeTimeZone}>{person.timeZoneLabel}</Block>}
      {person.questions.length > 0 && (
        <Block label={C.details.questions} testId="meeting-questions">
          <dl className="flex flex-col gap-3">
            {person.questions.map((qa, i) => (
              <div key={`${i}-${qa.question}`} className="flex flex-col gap-0.5">
                <dt className="font-semibold break-words">{qa.question}</dt>
                <dd className="break-words whitespace-pre-line text-ink-2">{qa.answer}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}
      {person.guests.length > 0 && (
        <Block label={C.details.guests} testId="meeting-guests">
          <ul className="flex flex-col gap-0.5">
            {person.guests.map((g) => (
              <li key={g} className="break-all">
                {g}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {person.tracking.length > 0 && (
        <Block label={C.details.tracking}>
          <dl className="flex flex-col gap-0.5">
            {person.tracking.map((t) => (
              <div key={t.label} className="flex flex-wrap gap-x-1.5">
                <dt className="text-ink-2">{t.label}:</dt>
                <dd className="break-all">{t.value}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}
    </>
  );
}

export function MeetingDetails({ meeting, now, onFilterByEventType, onCanceled, onRescheduled, onOpenMeeting, compact }: MeetingDetailsProps) {
  const [dialog, setDialog] = useState<"cancel" | "reschedule" | null>(null);
  const rescheduleRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const manage = meeting.access === "manage";
  const solo = !meeting.isGroup;
  const person = meeting.people[0] ?? null;
  const active = meeting.status === "active";
  const clock = now ?? undefined;
  const showNoShow = manage && active && now !== null;

  const actions = (
    <div className={cn("flex flex-col gap-2", compact ? "" : "md:w-56 md:shrink-0")} data-testid="meeting-actions">
      {(meeting.canReschedule || meeting.canCancel) && meeting.summary && (
        <div className={cn("flex gap-2", compact ? "flex-row flex-wrap" : "flex-row flex-wrap md:flex-col")}>
          {meeting.canReschedule && (
            <Button ref={rescheduleRef} variant="secondary" leftIcon={<CalendarClock aria-hidden="true" />} onClick={() => setDialog("reschedule")} className="md:justify-start">
              {C.details.reschedule}
            </Button>
          )}
          {meeting.canCancel && (
            <Button ref={cancelRef} variant="secondary" leftIcon={<Trash2 aria-hidden="true" />} onClick={() => setDialog("cancel")} className="md:justify-start">
              {C.details.cancel}
            </Button>
          )}
        </div>
      )}
      {showNoShow && solo && person && person.status === "active" && (
        <div className="flex flex-wrap items-center gap-2">
          <MarkNoShowButton inviteeId={person.id} inviteeName={person.name} noShow={person.noShow} meetingStart={meeting.start} now={clock} />
        </div>
      )}
      {!manage && person?.noShow && (
        <div>
          <Badge variant="warning">{C.details.noShowSection}</Badge>
        </div>
      )}
      <div className="flex flex-col items-start">
        {meeting.editEventTypeHref && (
          <Link href={meeting.editEventTypeHref as Route} className={cn(buttonClassName({ variant: "tertiary", size: "sm" }), "-ml-3")}>
            <Pencil aria-hidden="true" />
            {C.details.editEventType}
          </Link>
        )}
        {meeting.canFilterByEventType && (
          <Button variant="tertiary" size="sm" className="-ml-3" leftIcon={<Filter aria-hidden="true" />} onClick={() => onFilterByEventType(meeting.eventTypeId)}>
            {C.details.filterByEventType}
          </Button>
        )}
        {meeting.scheduleAgainHref && (
          <a href={meeting.scheduleAgainHref} target="_blank" rel="noopener noreferrer" className={cn(buttonClassName({ variant: "tertiary", size: "sm" }), "-ml-3")}>
            <ExternalLink aria-hidden="true" />
            {C.details.scheduleAgain}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
    </div>
  );

  return (
    <div className={cn("flex flex-col gap-6", !compact && "md:flex-row md:gap-8")} data-testid="meeting-details">
      {actions}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        {meeting.notices.map((n) => (
          <Notice key={`${n.kind}-${n.text}`} notice={n} onOpenMeeting={onOpenMeeting} />
        ))}
        {!manage && <p className="text-body-md text-ink-2">{C.details.viewOnly}</p>}
        {solo && person && (
          <Block label={C.details.email} testId="meeting-email">
            <div className="flex flex-wrap items-center gap-1">
              <a href={`mailto:${person.email}`} className="break-all text-primary-text hover:underline">
                {person.email}
              </a>
              <CopyButton value={person.email} iconOnly variant="ghost" size="sm" label={C.details.copyEmail} copiedLabel={C.details.emailCopied} toastMessage={C.details.emailCopied} />
            </div>
          </Block>
        )}
        {!solo && meeting.people.length > 0 && (
          <Block label={C.details.invitees} testId="meeting-invitees">
            <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-card)] border border-line">
              {meeting.people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-semibold break-words">{p.name}</span>
                    <a href={`mailto:${p.email}`} className="break-all text-primary-text hover:underline">
                      {p.email}
                    </a>
                  </div>
                  {showNoShow ? (
                    <MarkNoShowButton inviteeId={p.id} inviteeName={p.name} noShow={p.noShow} meetingStart={meeting.start} canceled={p.status !== "active"} now={clock} size="sm" />
                  ) : (
                    p.noShow && <Badge variant="warning">{C.details.noShowSection}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </Block>
        )}
        {meeting.location && <LocationBlock meetingId={meeting.id} location={meeting.location} canRetry={meeting.canRetry} />}
        {solo && person && <PersonBlocks person={person} />}
        {meeting.hosts.length > 0 && (
          <Block label={meeting.hosts.length > 1 ? C.details.hostsMany : C.details.hosts} testId="meeting-hosts">
            <ul className="flex flex-col gap-2">
              {meeting.hosts.map((h) => (
                <li key={h.id} className="flex items-center gap-2">
                  <Avatar src={h.avatarUrl} name={h.name} alt="" size="sm" />
                  <span className="break-words">{h.name}</span>
                </li>
              ))}
            </ul>
          </Block>
        )}
        {manage && <NotesEditor key={meeting.notesHtml ?? ""} scheduledEventId={meeting.id} initialHtml={meeting.notesHtml} />}
        <footer className="flex flex-col gap-0.5 border-t border-line pt-3 text-body-sm text-ink-2">
          <p>{meeting.createdLabel}</p>
          {meeting.scheduledByLabel && <p>{meeting.scheduledByLabel}</p>}
        </footer>
      </div>
      {meeting.summary && (
        <>
          <HostCancelDialog
            open={dialog === "cancel"}
            onOpenChange={(v) => setDialog(v ? "cancel" : null)}
            meeting={meeting.summary}
            now={clock}
            returnFocusRef={cancelRef}
            onCanceled={onCanceled}
          />
          <RescheduleChoiceDialog
            open={dialog === "reschedule"}
            onOpenChange={(v) => setDialog(v ? "reschedule" : null)}
            meeting={meeting.summary}
            now={clock}
            returnFocusRef={rescheduleRef}
            onRescheduled={(r) => onRescheduled(r.scheduledEventId)}
            onRequested={onCanceled}
          />
        </>
      )}
    </div>
  );
}
