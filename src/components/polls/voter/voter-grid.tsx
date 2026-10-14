// Grid view of the voter page (SPEC MP-07 "a Grid view toggle in everyone mode"; research B5.1 Doodle table):
// participants as rows and options as columns grouped by date, the viewer's editable row pinned on top. A real table
// with th scope, a sticky first column and header, horizontal scroll inside its container. Client component.
"use client";

import { cn } from "@/lib/cn";
import { groupOptionsByLocalDate, optionTimeLabel } from "@/lib/polls/display";
import type { VoteChoice, VoterOptionView, VoterParticipantView } from "@/lib/polls/types";
import { formatDateShort, formatWeekday } from "@/lib/time/format";
import { AnswerIcon } from "../answer-icon";
import { answerText, ariaChecked, attending, nextChoice } from "../lib/answers";
import { pt } from "../lib/t";

export type VoterGridProps = {
  options: VoterOptionView[];
  pollZone: string;
  zone: string;
  hour12: boolean;
  participants: VoterParticipantView[];
  answers: Record<string, VoteChoice>;
  allowIfNeedBe: boolean;
  single: boolean;
  editable: boolean;
  blockedReason: (optionId: string, next: VoteChoice) => string | null;
  onChange: (optionId: string, next: VoteChoice) => void;
};

export function VoterGrid(p: VoterGridProps) {
  const groups = groupOptionsByLocalDate(p.options, p.zone, p.pollZone);
  const ordered = groups.flatMap((g) => g.options);
  const others = p.participants.filter((x) => !x.isYou);
  return (
    <div className="max-w-full overflow-x-auto rounded-[var(--radius-card)] border border-line scrollbar-thin" data-testid="voter-grid">
      <table className="w-max min-w-full border-collapse text-body-md">
        <caption className="sr-only">{pt("voter.gridView")}</caption>
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className="sticky left-0 z-20 min-w-[140px] border-b border-line bg-white px-3 py-2 text-left text-label-sm text-ink-2">
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
              <th key={o.id} scope="col" className="min-w-[88px] border-b border-l border-line bg-white px-2 py-1.5 text-center text-body-sm font-semibold whitespace-nowrap text-ink">
                {optionTimeLabel(o, p.zone, { hour12: p.hour12 }).replace(" (ends next day)", "+1")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="bg-brand-soft">
            <th scope="row" className="sticky left-0 z-10 border-b border-line bg-[inherit] px-3 py-2 text-left text-label text-ink">
              <span className="block max-w-[180px] truncate">{pt("voter.youRow")}</span>
            </th>
            {ordered.map((o) => {
              const value = p.answers[o.id];
              const next = p.single ? (attending(value) ? "no" : "yes") : nextChoice(value, p.allowIfNeedBe);
              const blocked = p.blockedReason(o.id, next);
              const disabled = !p.editable || o.isPast || Boolean(blocked);
              return (
                <td key={o.id} className="border-b border-l border-line p-0 text-center">
                  <button
                    type="button"
                    role={p.single ? "radio" : "checkbox"}
                    aria-checked={p.single ? (attending(value) ? "true" : "false") : ariaChecked(value)}
                    aria-disabled={disabled || undefined}
                    aria-label={`${optionTimeLabel(o, p.zone, { hour12: p.hour12 })}: ${answerText(value)}`}
                    title={blocked ?? undefined}
                    onClick={() => !disabled && p.onChange(o.id, next)}
                    className={cn("inline-flex h-11 w-full items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand", disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-white")}
                  >
                    <AnswerIcon value={value ?? "no"} size={20} />
                  </button>
                </td>
              );
            })}
          </tr>
          {others.map((x) => (
            <tr key={x.key}>
              <th scope="row" className="sticky left-0 z-10 border-b border-line bg-white px-3 py-2 text-left font-normal text-ink">
                <span className="block max-w-[180px] truncate">{x.name}</span>
                {x.status === "declined" && <span className="text-body-sm text-ink-2">{pt("results.declined")}</span>}
              </th>
              {ordered.map((o) => {
                const v = x.votes[o.id];
                return (
                  <td key={o.id} className="border-b border-l border-line px-2 py-2 text-center">
                    <span className="inline-flex justify-center">
                      <AnswerIcon value={v ?? "none"} size={18} title={v ? answerText(v) : pt("common.noAnswer")} />
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
