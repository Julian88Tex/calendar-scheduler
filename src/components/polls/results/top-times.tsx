// "Top times" of the results page (SPEC MP-16, MP-28; research B6 view 1, B19; Calendly "Top times"): the future options
// in rank order in the chosen zone, each with an availability bar (green Yes, amber If need be, gray No, light no
// answer), "5 Yes, 1 If need be, 2 No" (names on hover or tap), the "Best" star on the top tie group, "All required can
// attend", the host calendar status (free, amber "Conflicts with '{title}'", red "Booked: {event}") and "Book"; started
// options are collapsed under "Past times". Client component.
"use client";

import { CalendarCheck, ChevronDown, Star } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { optionTimeLabel } from "@/lib/polls/display";
import type { HostCalendarStatus, RankedOptionView, VoteChoice } from "@/lib/polls/types";
import { formatDateLong, formatDuration } from "@/lib/time/format";
import { AnswerIcon } from "../answer-icon";
import { pt } from "../lib/t";

export function hostStatusText(s: HostCalendarStatus): { text: string; tone: "ok" | "warn" | "bad" | "muted" } {
  switch (s.state) {
    case "free":
      return { text: pt("results.hostFree"), tone: "ok" };
    case "conflict":
      return { text: s.title ? pt("results.hostConflict", { title: s.title }) : pt("results.hostConflictUntitled", { host: s.hostName ?? pt("common.host") }), tone: "warn" };
    case "hold":
      return { text: s.title ? pt("results.hostHold", { title: s.title }) : pt("results.hostHoldUntitled"), tone: "warn" };
    case "booked":
      return { text: s.title ? pt("results.hostBooked", { title: s.title }) : pt("results.hostBookedUntitled"), tone: "bad" };
    default:
      return { text: pt("results.hostUnknown"), tone: "muted" };
  }
}

export function countsText(o: RankedOptionView, allowIfNeedBe: boolean): string {
  return allowIfNeedBe || o.counts.ifNeedBe > 0
    ? pt("results.countsLine", { yes: o.counts.yes, maybe: o.counts.ifNeedBe, no: o.counts.no })
    : pt("results.countsLineNoMaybe", { yes: o.counts.yes, no: o.counts.no });
}

function AvailabilityBar({ o }: { o: RankedOptionView }) {
  const total = o.counts.yes + o.counts.ifNeedBe + o.counts.no + o.counts.noAnswer;
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  return (
    <span aria-hidden="true" className="flex h-2 w-full max-w-[220px] overflow-hidden rounded-full bg-mist">
      <span className="h-full bg-success" style={{ width: pct(o.counts.yes) }} />
      <span className="h-full bg-warning" style={{ width: pct(o.counts.ifNeedBe) }} />
      <span className="h-full bg-line-medium" style={{ width: pct(o.counts.no) }} />
    </span>
  );
}

function Names({ title, names, choice }: { title: string; names: string[]; choice: VoteChoice }) {
  if (!names.length) return null;
  return (
    <div className="mb-2 last:mb-0">
      <p className="mb-1 flex items-center gap-1.5 text-label-sm text-ink-2">
        <AnswerIcon value={choice} size={14} />
        {title} ({names.length})
      </p>
      <ul className="text-body-md text-ink">
        {names.map((n, i) => (
          <li key={`${n}-${i}`} className="break-words">
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type TopTimesProps = {
  options: RankedOptionView[];
  ranking: string[];
  zone: string;
  pollZone: string;
  hour12: boolean;
  allowIfNeedBe: boolean;
  hasRequired: boolean;
  mixedDurations: boolean;
  canBook: boolean;
  bookedMeetingActive: boolean;
  onBook: (optionId: string) => void;
};

function TimeRow({ o, p }: { o: RankedOptionView; p: TopTimesProps }) {
  const date = o.allDayDate ? formatDateLong(`${o.allDayDate}T12:00:00Z`, "UTC") : formatDateLong(o.start!, p.zone);
  const time = optionTimeLabel(o, p.zone, { hour12: p.hour12 });
  const host = hostStatusText(o.hostStatus);
  const answered = o.counts.yes + o.counts.ifNeedBe + o.counts.no > 0;
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-card)] border bg-white px-4 py-3 md:flex-row md:items-center md:gap-6",
        o.isBooked ? "border-success" : o.isBest ? "border-primary" : "border-line",
        o.isPast && "bg-pebble",
      )}
      data-testid="top-time"
      data-option-id={o.id}
      data-best={o.isBest || undefined}
    >
      <div className="min-w-0 md:w-[260px] md:shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-label text-ink">{date}</p>
          {o.isBest && (
            <Badge variant="info" icon={<Star aria-hidden="true" className="fill-current" />} title={pt("results.bestHint")} data-testid="best-badge">
              {pt("results.best")}
            </Badge>
          )}
          {o.isBooked && (
            <Badge variant="success" icon={<CalendarCheck aria-hidden="true" />}>
              {pt("results.booked")}
            </Badge>
          )}
          {o.isFull && <Badge variant="warning">{pt("results.full")}</Badge>}
        </div>
        <p className="text-body-md text-ink">
          {time}
          {p.mixedDurations && !o.allDayDate && <span className="text-ink-2"> · {formatDuration(o.durationMinutes)}</span>}
        </p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <AvailabilityBar o={o} />
        {answered ? (
          <Popover
            side="top"
            align="start"
            aria-label={pt("results.whoAnswered")}
            className="w-64 p-3"
            trigger={
              <button type="button" className="w-fit rounded-[2px] text-left text-body-md text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus" data-testid="top-time-counts">
                {countsText(o, p.allowIfNeedBe)}
              </button>
            }
          >
            <Names title={pt("common.yes")} names={o.voters.yes} choice="yes" />
            <Names title={pt("common.ifNeedBe")} names={o.voters.ifNeedBe} choice="if_need_be" />
            <Names title={pt("common.no")} names={o.voters.no} choice="no" />
          </Popover>
        ) : (
          <p className="text-body-md text-ink-2">{pt("results.noAnswers")}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm">
          {p.hasRequired && (
            <span className={o.requiredOk ? "text-success-text" : "text-ink-2"}>{o.requiredOk ? pt("results.requiredOk") : pt("results.requiredMissing")}</span>
          )}
          {!o.isPast && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                host.tone === "ok" ? "text-success-text" : host.tone === "warn" ? "text-warning-text" : host.tone === "bad" ? "text-danger-text" : "text-ink-2",
              )}
              data-testid="host-status"
            >
              <span aria-hidden="true" className={cn("size-2 rounded-full", host.tone === "ok" ? "bg-success" : host.tone === "warn" ? "bg-warning" : host.tone === "bad" ? "bg-danger" : "bg-ink-3")} />
              {host.text}
            </span>
          )}
        </div>
      </div>
      {!o.isPast && p.canBook && (
        <div className="shrink-0">
          <Button size="sm" variant={o.isBest ? "primary" : "secondary"} onClick={() => p.onBook(o.id)} aria-label={`${pt("results.book")} ${date}, ${time}`} data-testid="book-option">
            {pt("results.book")}
          </Button>
        </div>
      )}
    </li>
  );
}

export function TopTimes(p: TopTimesProps) {
  const [pastOpen, setPastOpen] = useState(false);
  const byId = new Map(p.options.map((o) => [o.id, o]));
  const future = p.ranking.map((id) => byId.get(id)).filter((o): o is RankedOptionView => Boolean(o));
  const past = p.options.filter((o) => o.isPast);
  return (
    <div className="flex flex-col gap-4" data-testid="top-times">
      {future.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-6 text-center">
          <p className="text-title-sm text-ink">{pt("results.noFutureTimes")}</p>
          <p className="mt-1 text-body-md text-ink-2">{pt("results.noFutureTimesHint")}</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-2" aria-label={pt("results.topTimes")}>
          {future.map((o) => (
            <TimeRow key={o.id} o={o} p={p} />
          ))}
        </ol>
      )}
      {past.length > 0 && (
        <Collapsible open={pastOpen} onOpenChange={setPastOpen}>
          <CollapsibleTrigger asChild>
            <button type="button" className="flex items-center gap-1.5 text-label text-primary-text hover:underline">
              <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", pastOpen && "rotate-180")} />
              {pt("results.pastTimes", { count: past.length })}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 flex flex-col gap-2">
              {past.map((o) => (
                <TimeRow key={o.id} o={o} p={p} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
