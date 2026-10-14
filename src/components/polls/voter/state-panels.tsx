// Voter page states other than voting (SPEC MP-11, MP-15; research B5.5, B5.9): the confirmation after sharing times
// ("Thanks for voting!" with the chosen times and "Edit your preferred times"), the booked meeting ("This meeting has
// been scheduled." with the time in the voter's zone, location, join link and "Add to calendar"), voting closed, the
// ended poll, and the canceled poll (HTTP 410 in the API, "This poll is no longer available."). Client component.
"use client";

import type * as React from "react";
import { CalendarDays, CalendarPlus, CalendarX2, CheckCircle2, Clock3, Video, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { groupOptionsByLocalDate, optionTimeLabel } from "@/lib/polls/display";
import type { BookedMeetingView, PollLocationView, VoteChoice, VoterOptionView } from "@/lib/polls/types";
import { formatDateLong, formatTimeRange } from "@/lib/time/format";
import { AnswerIcon } from "../answer-icon";
import { answerText, attending } from "../lib/answers";
import { pt } from "../lib/t";

export function StateIcon({ kind }: { kind: "success" | "closed" | "ended" | "canceled" }) {
  const Icon = kind === "success" ? CheckCircle2 : kind === "closed" ? Clock3 : kind === "ended" ? CalendarX2 : XCircle;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-12 items-center justify-center rounded-full",
        kind === "success" ? "bg-success-soft text-success" : kind === "canceled" ? "bg-danger-soft text-danger-text" : "bg-mist text-ink-2",
      )}
    >
      <Icon className="size-7" />
    </span>
  );
}

/** The voter's answers grouped by date in their zone (attending ones, or every answer with `all`). */
export function AnswerSummary({
  options,
  votes,
  zone,
  pollZone,
  hour12,
  all = false,
}: {
  options: VoterOptionView[];
  votes: Record<string, VoteChoice>;
  zone: string;
  pollZone: string;
  hour12: boolean;
  all?: boolean;
}) {
  const chosen = options.filter((o) => (all ? Boolean(votes[o.id]) : attending(votes[o.id])));
  if (!chosen.length) return <p className="text-body-md text-ink-2">{pt("voter.selectedNone")}</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="answer-summary">
      {groupOptionsByLocalDate(chosen, zone, pollZone).map((g) => (
        <div key={g.date}>
          <p className="text-label text-public-text">{g.label}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {g.options.map((o) => (
              <li key={o.id} className="flex items-center gap-2 text-body-md text-public-text">
                <AnswerIcon value={votes[o.id] ?? "no"} size={16} />
                <span>{optionTimeLabel(o, zone, { hour12 })}</span>
                <span className="text-ink-2">({answerText(votes[o.id])})</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function DonePanel(p: {
  declined: boolean;
  options: VoterOptionView[];
  votes: Record<string, VoteChoice>;
  zone: string;
  pollZone: string;
  hour12: boolean;
  hasEmail: boolean;
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center" data-testid="vote-confirmation">
      <StateIcon kind="success" />
      <h2 className="mt-4 text-headline-3 text-public-text" tabIndex={-1} data-autofocus>
        {p.declined ? pt("voter.declinedThanks") : pt("voter.thanks")}
      </h2>
      <p className="mt-2 max-w-[420px] text-body text-ink-2">
        {p.declined ? pt("voter.declinedDescription") : p.hasEmail ? pt("voter.thanksDescription") : pt("voter.thanksNoEmail")}
      </p>
      {!p.declined && (
        <div className="mt-6 w-full max-w-[420px] rounded-[var(--radius-card)] border border-line p-4 text-left">
          <p className="mb-2 text-eyebrow text-ink-2">{pt("voter.youChose")}</p>
          <AnswerSummary options={p.options} votes={p.votes} zone={p.zone} pollZone={p.pollZone} hour12={p.hour12} />
        </div>
      )}
      {p.hasEmail && <p className="mt-4 text-body-sm text-ink-2">{pt("voter.editLaterHint")}</p>}
      {p.canEdit && (
        <Button type="button" variant="secondary" className="mt-6" onClick={p.onEdit}>
          {pt("voter.editTimes")}
        </Button>
      )}
    </div>
  );
}

export function BookedPanel({ booked, zone, hour12, location }: { booked: BookedMeetingView; zone: string; hour12: boolean; location: PollLocationView }) {
  const when = booked.allDayDate
    ? `${formatDateLong(`${booked.allDayDate}T12:00:00Z`, "UTC")}, ${pt("common.allDay")}`
    : `${formatTimeRange(booked.start, booked.end, zone, "en", hour12)}, ${formatDateLong(booked.start, zone)}`;
  const canceled = booked.status === "canceled";
  const place = booked.locationText ?? (location && !location.isConference ? location.text : null);
  return (
    <div className="flex flex-col items-center text-center" data-testid="poll-booked">
      <StateIcon kind={canceled ? "canceled" : "success"} />
      <h2 className="mt-4 text-headline-3 text-public-text" tabIndex={-1} data-autofocus>
        {canceled ? pt("voter.bookedCanceled") : pt("voter.bookedTitle")}
      </h2>
      <div className={cn("mt-6 w-full max-w-[440px] rounded-[var(--radius-card)] border border-line p-5 text-left", canceled && "opacity-80")}>
        <p className="flex items-start gap-2 text-body text-public-text">
          <CalendarDays aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-navy" />
          <span className={cn("font-semibold", canceled && "line-through")} data-testid="booked-when">
            {when}
          </span>
        </p>
        {location?.isConference && !canceled && (
          <p className="mt-3 flex items-start gap-2 text-body-md text-ink-2">
            <Video aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-navy" />
            <span>{booked.joinUrl ? location.provider ?? pt("voter.meetingLink") : location.text}</span>
          </p>
        )}
        {place && !canceled && <p className="mt-3 text-body-md whitespace-pre-line text-ink-2">{place}</p>}
        {booked.joinUrl && !canceled && (
          <Button asChild className="mt-4" fullWidth>
            <a href={booked.joinUrl} target="_blank" rel="noopener noreferrer">
              <Video aria-hidden="true" className="size-4" />
              {pt("voter.joinMeeting")}
            </a>
          </Button>
        )}
      </div>
      {booked.addToCalendar.length > 0 && !canceled && (
        <div className="mt-6 w-full max-w-[440px]">
          <p className="mb-2 text-label text-public-text">{pt("voter.addToCalendar")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {booked.addToCalendar.map((l) => (
              <Button key={l.id} asChild variant="secondary" size="sm">
                <a href={l.url} target={l.id === "ical" ? undefined : "_blank"} rel="noopener noreferrer" download={l.id === "ical" ? true : undefined}>
                  <CalendarPlus aria-hidden="true" className="size-4" />
                  {l.label}
                </a>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function MessagePanel({ kind, title, hint, children }: { kind: "closed" | "ended" | "canceled"; title: string; hint?: string | null; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center" data-testid={`poll-state-${kind}`}>
      <StateIcon kind={kind} />
      <h2 className="mt-4 text-headline-3 text-public-text" tabIndex={-1} data-autofocus>
        {title}
      </h2>
      {hint && <p className="mt-2 max-w-[420px] text-body text-ink-2">{hint}</p>}
      {children && <div className="mt-6 w-full text-left">{children}</div>}
    </div>
  );
}
