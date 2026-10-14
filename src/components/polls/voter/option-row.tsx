// One proposed time on the voter page (SPEC MP-07, MP-08, MP-12, MP-13; research B5.1, B5.2, B17).
//
// Answer control: a button with role="checkbox" (aria-checked true for Yes, mixed for If need be, false for No) and a
// label like "Tuesday, October 20, 10:00am - 10:30am: If need be". Click, Space or Enter cycles Yes -> If need be -> No
// (Yes <-> No when If need be is off; with "Max choices" 1 the list behaves like radio buttons). With If need be on,
// pointer users also get the "Yes | If need be | No" segmented control (hover) and a long-press or right-click menu.
// Disabled reasons (Full, Past, max choices) show as a tooltip and stay announced through aria-describedby.
// Vote summaries ("3 Votes (1 if need be)") list names in a popover when the poll shows them. Client component.
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { FreeBusyStatus, VoteChoice, VoterOptionView } from "@/lib/polls/types";
import { optionTimeLabel } from "@/lib/polls/display";
import { formatDuration } from "@/lib/time/format";
import { AnswerIcon, CheckboxGlyph } from "../answer-icon";
import { answerText, ariaChecked, attending, nextChoice } from "../lib/answers";
import { votesLabel } from "../lib/format";
import { pt } from "../lib/t";

export type OptionRowProps = {
  option: VoterOptionView;
  /** "Tuesday, October 20" style date of the group (for the accessible label). */
  dateLabel: string;
  zone: string;
  hour12: boolean;
  showDuration: boolean;
  value: VoteChoice | undefined;
  allowIfNeedBe: boolean;
  /** "Max choices" 1: radio semantics. */
  single: boolean;
  /** Why a choice is blocked (null: allowed). */
  blockedReason: (next: VoteChoice) => string | null;
  onChange: (next: VoteChoice) => void;
  readOnly: boolean;
  freeBusy: FreeBusyStatus | null;
  /** "?" for options added after the viewer's last submit. */
  isNew: boolean;
};

const SEGMENTS: VoteChoice[] = ["yes", "if_need_be", "no"];

export function OptionRow(p: OptionRowProps) {
  const id = useId();
  const [menu, setMenu] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const timeText = optionTimeLabel(p.option, p.zone, { hour12: p.hour12 });
  const cycleTo = p.single ? (attending(p.value) ? "no" : "yes") : nextChoice(p.value, p.allowIfNeedBe);
  const blocked = p.readOnly ? null : p.blockedReason(cycleTo);
  const disabled = p.readOnly || p.option.isPast || Boolean(blocked);
  const label = `${p.dateLabel}, ${timeText}: ${answerText(p.value)}`;
  const hintId = `${id}-hint`;
  const hint = p.option.isPast ? pt("voter.past") : blocked;
  const selected = attending(p.value);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    rowRef.current?.querySelector<HTMLButtonElement>("[role=menuitemradio]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const choose = (next: VoteChoice) => {
    if (p.readOnly || p.option.isPast) return;
    if (p.blockedReason(next)) return;
    p.onChange(next);
  };

  const clearTimer = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const control = (
    <button
      type="button"
      role={p.single ? "radio" : "checkbox"}
      aria-checked={p.single ? (selected ? "true" : "false") : ariaChecked(p.value)}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-describedby={hint ? hintId : undefined}
      data-testid="answer-control"
      data-choice={p.value ?? "no"}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        if (!disabled) choose(cycleTo);
      }}
      onPointerDown={(e) => {
        if (!p.allowIfNeedBe || p.readOnly || p.option.isPast || e.pointerType === "mouse") return;
        longPressed.current = false;
        pressTimer.current = setTimeout(() => {
          longPressed.current = true;
          setMenu(true);
        }, 500);
      }}
      onPointerUp={clearTimer}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      onContextMenu={(e) => {
        if (!p.allowIfNeedBe || p.readOnly || p.option.isPast) return;
        e.preventDefault();
        setMenu(true);
      }}
      className={cn(
        "flex min-h-[54px] min-w-0 flex-1 items-center gap-3 rounded-[4px] py-2.5 pr-2 pl-4 text-left outline-none",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      {p.allowIfNeedBe ? (
        <AnswerIcon value={p.value ?? "no"} size={22} />
      ) : (
        <CheckboxGlyph checked={p.value === "yes"} disabled={disabled} className={p.single ? "rounded-full" : undefined} />
      )}
      <span className="flex min-w-0 flex-col">
        <span className={cn("text-[16px] leading-6 font-bold", p.option.isPast ? "text-ink-2" : "text-public-text")}>{timeText}</span>
        {(p.showDuration || p.isNew) && (
          <span className="text-body-sm text-ink-2">
            {p.showDuration && !p.option.allDayDate && formatDuration(p.option.durationMinutes)}
            {p.showDuration && p.isNew && " · "}
            {p.isNew && pt("voter.newTime")}
          </span>
        )}
      </span>
    </button>
  );

  return (
    <div
      ref={rowRef}
      data-testid="poll-option"
      data-option-id={p.option.id}
      className={cn(
        "group relative flex min-w-0 flex-wrap items-center gap-x-2 rounded-[4px] border bg-white transition-colors",
        p.value === "yes" ? "border-brand bg-brand-soft" : p.value === "if_need_be" ? "border-warning bg-warning-soft/40" : "border-line",
        !disabled && "hover:border-brand",
        p.option.isPast && "bg-pebble",
      )}
    >
      {hint && !p.readOnly && !p.option.isPast ? (
        <Tooltip content={hint}>
          <span className="flex min-w-0 flex-1">{control}</span>
        </Tooltip>
      ) : (
        control
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 py-2 pr-3">
        {p.option.isFull && <Badge variant="warning">{pt("voter.full")}</Badge>}
        {p.option.isPast && <Badge variant="neutral">{pt("voter.past")}</Badge>}
        {p.freeBusy === "busy" && (
          <Badge variant="danger" title={pt("voter.busyHint")}>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-danger" />
            {pt("voter.conflict")}
            <span className="sr-only">: {pt("voter.busyHint")}</span>
          </Badge>
        )}
        {p.freeBusy === "free" && (
          <Badge variant="success" title={pt("voter.freeHint")}>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
            {pt("voter.free")}
          </Badge>
        )}
        <VoteSummary option={p.option} />
        {p.allowIfNeedBe && !p.readOnly && !p.option.isPast && (
          // Pointer shortcut: the role="checkbox" control is the keyboard and screen reader path.
          <div aria-hidden="true" className="hidden items-center rounded-full border border-line bg-white p-0.5 pointer-fine:group-hover:flex">
            {SEGMENTS.map((c) => (
              <button
                key={c}
                type="button"
                tabIndex={-1}
                onClick={() => choose(c)}
                disabled={Boolean(p.blockedReason(c))}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[12px] font-semibold text-ink-2 disabled:opacity-40",
                  p.value === c || (!p.value && c === "no") ? "bg-mist text-ink" : "hover:bg-pebble",
                )}
              >
                {answerText(c)}
              </button>
            ))}
          </div>
        )}
      </div>
      {hint && (
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      )}
      {menu && (
        <div role="menu" aria-label={label} className="absolute top-full left-2 z-20 mt-1 flex flex-col rounded-[var(--radius-card)] border border-line bg-white py-1 shadow-[var(--shadow-pop)]">
          {SEGMENTS.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              aria-checked={(p.value ?? "no") === c}
              disabled={Boolean(p.blockedReason(c))}
              onClick={() => {
                choose(c);
                setMenu(false);
              }}
              className="flex min-h-10 items-center gap-2 px-3 text-left text-body-md text-ink hover:bg-pebble focus-visible:bg-pebble disabled:opacity-40"
            >
              <AnswerIcon value={c} size={18} />
              {answerText(c)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "3 Votes (1 if need be)" with the names in a popover (everyone, after_vote once submitted) or counts only. */
export function VoteSummary({ option }: { option: VoterOptionView }) {
  if (!option.counts) return null;
  const total = option.counts.yes + option.counts.ifNeedBe;
  const text = (
    <>
      <span className="font-semibold">{votesLabel(total)}</span>
      {option.counts.ifNeedBe > 0 && <span className="text-ink-2"> {pt("voter.ifNeedBeCount", { count: option.counts.ifNeedBe })}</span>}
    </>
  );
  if (!option.voters || total === 0) {
    return (
      <span className="text-body-sm text-ink" data-testid="vote-summary">
        {text}
      </span>
    );
  }
  const voters = option.voters;
  return (
    <Popover
      side="top"
      aria-label={votesLabel(total)}
      className="w-60 p-3"
      trigger={
        <button type="button" data-testid="vote-summary" className="rounded-[4px] px-1 text-body-sm text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand">
          {text}
        </button>
      }
    >
      <NameList title={pt("voter.votedYes")} names={voters.yes} choice="yes" />
      <NameList title={pt("voter.votedIfNeedBe")} names={voters.ifNeedBe} choice="if_need_be" />
    </Popover>
  );
}

function NameList({ title, names, choice }: { title: string; names: string[]; choice: VoteChoice }) {
  if (!names.length) return null;
  return (
    <div className="mb-2 last:mb-0">
      <p className="mb-1 flex items-center gap-1.5 text-label-sm text-ink-2">
        <AnswerIcon value={choice} size={14} />
        {title} ({names.length})
      </p>
      <ul className="flex flex-col gap-0.5 text-body-md text-ink">
        {names.map((n, i) => (
          <li key={`${n}-${i}`} className="break-words">
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

