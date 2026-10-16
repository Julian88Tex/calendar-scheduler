// The results "Grid" (SPEC MP-17; research B6 view 2, Doodle table): rows are the host's calendar (Free / Busy per
// option), "Your preference" (Doodle organizer answers; counted only with "Count my preference"), respondents in
// submission order, then invited people who haven't responded (grayed, "Invited, no response"); columns are options
// grouped by date. Cells: check (Yes), tilde (If need be), empty (No), "?" (added after their last answer), dash (no
// answer). A totals row with the star over the best columns. A real table with th scope, a sticky first column and a
// sticky header (it stays on top while the rows scroll inside the container, which also scrolls sideways). Row menu:
// Edit votes, Copy email, Mark as required, Resend invite, Send reminder, Remove. Client component.
"use client";

import { MoreVertical, Star, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { groupOptionsByLocalDate, optionTimeLabel } from "@/lib/polls/display";
import type { HostParticipantView, RankedOptionView, VoteChoice } from "@/lib/polls/types";
import { formatDateShort, formatWeekday } from "@/lib/time/format";
import { AnswerIcon, type AnswerMark } from "../answer-icon";
import { answerText, nextChoice } from "../lib/answers";
import { pt } from "../lib/t";
import { hostStatusText } from "./top-times";

export type RowAction = "edit" | "copy_email" | "required" | "resend" | "remind" | "remove";

export type ResultsGridProps = {
  options: RankedOptionView[];
  participants: HostParticipantView[];
  zone: string;
  pollZone: string;
  hour12: boolean;
  allowIfNeedBe: boolean;
  hostPreferences: Record<string, VoteChoice>;
  countHostPreference: boolean;
  /** Writes are possible (open or closed poll). */
  editable: boolean;
  onPreference: (optionId: string, choice: VoteChoice) => void;
  onCountPreference: (on: boolean) => void;
  onRowAction: (participant: HostParticipantView, action: RowAction) => void;
  onAddParticipant: () => void;
};

function cellMark(p: HostParticipantView, optionId: string): AnswerMark {
  const v = p.votes[optionId];
  if (v) return v;
  if (p.unknownOptionIds.includes(optionId)) return "unknown";
  return "none";
}

function cellTitle(mark: AnswerMark): string {
  return mark === "unknown" ? pt("results.addedLater") : mark === "none" ? pt("common.noAnswer") : answerText(mark);
}

export function ResultsGrid(p: ResultsGridProps) {
  const groups = groupOptionsByLocalDate(p.options, p.zone, p.pollZone);
  const ordered = groups.flatMap((g) => g.options);
  const respondents = p.participants
    .filter((x) => x.status !== "invited")
    .sort((a, b) => (a.respondedAt ?? a.createdAt).localeCompare(b.respondedAt ?? b.createdAt));
  const invited = p.participants.filter((x) => x.status === "invited");
  const label = (o: RankedOptionView) => optionTimeLabel(o, p.zone, { hour12: p.hour12 }).replace(" (ends next day)", "+1");

  return (
    <div className="flex flex-col gap-3" data-testid="results-grid">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Switch checked={p.countHostPreference} onCheckedChange={p.onCountPreference} disabled={!p.editable} label={pt("results.countPreference")} />
        </div>
        {p.editable && (
          <Button variant="secondary" size="sm" leftIcon={<UserPlus aria-hidden="true" className="size-4" />} onClick={p.onAddParticipant}>
            {pt("results.addParticipant")}
          </Button>
        )}
      </div>
      <div className="max-h-[min(70vh,720px)] max-w-full overflow-auto rounded-[var(--radius-card)] border border-line bg-white scrollbar-thin">
        <table className="w-max min-w-full border-collapse text-body-md">
          <caption className="sr-only">{pt("results.gridCaption")}</caption>
          <thead className="sticky top-0 z-20">
            <tr>
              <th scope="col" rowSpan={2} className="sticky left-0 z-30 min-w-[200px] border-b border-line bg-white px-3 py-2 text-left text-label-sm text-ink-2">
                {pt("results.participant")}
              </th>
              {groups.map((g) => (
                <th key={g.date} scope="colgroup" colSpan={g.options.length} className="border-b border-l border-line bg-pebble px-2 py-1.5 text-center text-label-sm whitespace-nowrap text-ink">
                  {formatWeekday(`${g.date}T12:00:00Z`, "UTC")}, {formatDateShort(`${g.date}T12:00:00Z`, "UTC")}
                </th>
              ))}
            </tr>
            <tr>
              {ordered.map((o) => (
                <th key={o.id} scope="col" className={cn("min-w-[92px] border-b border-l border-line bg-white px-2 py-1.5 text-center text-body-sm font-semibold whitespace-nowrap text-ink", o.isPast && "text-ink-2")}>
                  {o.isBest && (
                    <>
                      <Star aria-hidden="true" className="mx-auto mb-0.5 size-4 fill-primary text-primary" />
                      <span className="sr-only">{pt("results.best")}: </span>
                    </>
                  )}
                  {label(o)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-pebble">
              <th scope="row" className="sticky left-0 z-10 border-b border-line bg-pebble px-3 py-2 text-left text-label text-ink">
                {pt("results.yourAvailability")}
              </th>
              {ordered.map((o) => {
                const s = o.hostStatus;
                const busy = s.state === "conflict" || s.state === "booked" || s.state === "hold";
                const text = hostStatusText(s).text;
                return (
                  <td key={o.id} className="border-b border-l border-line px-2 py-2 text-center text-body-sm" title={text}>
                    {o.isPast ? (
                      <span className="text-ink-3">-</span>
                    ) : s.state === "unknown" ? (
                      <span className="text-ink-2">?</span>
                    ) : (
                      <span className={busy ? (s.state === "booked" ? "font-semibold text-danger-text" : "font-semibold text-warning-text") : "text-success-text"}>
                        {busy ? pt("results.hostRowBusy") : pt("results.hostRowFree")}
                        <span className="sr-only">: {text}</span>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
            <tr>
              <th scope="row" className="sticky left-0 z-10 border-b border-line bg-white px-3 py-2 text-left text-label text-ink">
                {pt("results.yourPreference")}
              </th>
              {ordered.map((o) => {
                const v = p.hostPreferences[o.id];
                const disabled = !p.editable || o.isPast;
                return (
                  <td key={o.id} className="border-b border-l border-line p-0 text-center">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => p.onPreference(o.id, nextChoice(v, p.allowIfNeedBe))}
                      aria-label={`${pt("results.yourPreference")}, ${label(o)}: ${v ? answerText(v) : pt("common.noAnswer")}`}
                      className="inline-flex h-10 w-full items-center justify-center hover:bg-primary-soft disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                    >
                      <AnswerIcon value={v ?? "none"} size={18} />
                    </button>
                  </td>
                );
              })}
            </tr>
            {respondents.map((x) => (
              <ParticipantRow key={x.id} x={x} ordered={ordered} p={p} />
            ))}
            {invited.map((x) => (
              <ParticipantRow key={x.id} x={x} ordered={ordered} p={p} invited />
            ))}
            <tr className="bg-pebble">
              <th scope="row" className="sticky left-0 z-10 bg-pebble px-3 py-2 text-left text-label text-ink">
                {pt("results.totals")}
              </th>
              {ordered.map((o) => (
                <td key={o.id} className={cn("border-l border-line px-2 py-2 text-center text-label", o.isBest ? "text-primary-text" : "text-ink")} data-testid="grid-total">
                  {o.counts.yes + o.counts.ifNeedBe}
                  {o.counts.ifNeedBe > 0 && <span className="block text-body-sm font-normal text-ink-2">({o.counts.ifNeedBe} ~)</span>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParticipantRow({ x, ordered, p, invited = false }: { x: HostParticipantView; ordered: RankedOptionView[]; p: ResultsGridProps; invited?: boolean }) {
  return (
    <tr className={cn(invited && "text-ink-2")} data-testid="grid-participant">
      <th scope="row" className="sticky left-0 z-10 border-b border-line bg-white px-3 py-2 text-left font-normal">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className={cn("max-w-[180px] truncate text-label", invited ? "text-ink-2" : "text-ink")}>{x.name || x.email}</p>
            <div className="flex flex-wrap gap-1">
              {invited && <span className="text-body-sm text-ink-2">{pt("results.invitedNoResponse")}</span>}
              {x.status === "declined" && <Badge variant="neutral" size="sm">{pt("results.declined")}</Badge>}
              {x.isRequired && <Badge variant="info" size="sm">{pt("results.required")}</Badge>}
              {x.overLimit && <Badge variant="warning" size="sm">{pt("results.overLimit")}</Badge>}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label={pt("results.rowMenu", { name: x.name || x.email || "" })} size="sm">
                <MoreVertical aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[200px]">
              {p.editable && <DropdownMenuItem onSelect={() => p.onRowAction(x, "edit")}>{pt("results.editVotes")}</DropdownMenuItem>}
              {x.email && <DropdownMenuItem onSelect={() => p.onRowAction(x, "copy_email")}>{pt("results.copyEmail")}</DropdownMenuItem>}
              {p.editable && <DropdownMenuItem onSelect={() => p.onRowAction(x, "required")}>{x.isRequired ? pt("results.unmarkRequired") : pt("results.markRequired")}</DropdownMenuItem>}
              {p.editable && invited && x.email && <DropdownMenuItem onSelect={() => p.onRowAction(x, "resend")}>{pt("results.resendInvite")}</DropdownMenuItem>}
              {p.editable && invited && x.email && !x.unsubscribed && <DropdownMenuItem onSelect={() => p.onRowAction(x, "remind")}>{pt("results.sendReminder")}</DropdownMenuItem>}
              {p.editable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => p.onRowAction(x, "remove")}>
                    {pt("results.removeParticipant")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </th>
      {ordered.map((o) => {
        const mark = invited ? "none" : cellMark(x, o.id);
        return (
          <td key={o.id} className="border-b border-l border-line px-2 py-2 text-center">
            <span className="inline-flex justify-center">
              <AnswerIcon value={mark} size={18} title={cellTitle(mark)} className={invited ? "opacity-50" : undefined} />
            </span>
          </td>
        );
      })}
    </tr>
  );
}
