// Owner troubleshoot mode of the times column (SPEC BK-24, SCH-21, SCOPE priority 4): every candidate start of the
// day; available ones are normal time buttons (with the [time][Next] split), unavailable ones have a dashed #A6BBD1
// border and the reason code chip ("CALENDAR", "DAILY MAX", "Outside working hours"). A chip opens a side sheet with
// the meaning, the fix hint and the blockers (calendar event titles for the owner only), plus a link to the full
// Troubleshoot view of the availability module.
"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { reasonHint, reasonLabel } from "@/lib/slots/reasons";
import type { ReasonCode } from "@/lib/slots/types";
import type { TroubleshootBlockerView, TroubleshootCandidateView } from "./lib/slots";
import { bt } from "./lib/t";

export type TroubleshootListProps = {
  dateLabel: string;
  candidates: TroubleshootCandidateView[];
  formatTime: (ms: number) => string;
  selected: string | null;
  onSelect: (iso: string) => void;
  onNext: (iso: string) => void;
  /** The availability module's Troubleshoot view for this day (owners). */
  fullUrl: string | null;
};

function isOutsideHours(c: TroubleshootCandidateView): boolean {
  return c.status === "outside_hours" || (c.outsideHours && c.reasons.length === 0);
}

/** The short chip label ("CALENDAR", "DAILY MAX", "OUTSIDE HOURS"): it must fit next to the time without truncating. */
function chipLabel(c: TroubleshootCandidateView): string {
  if (isOutsideHours(c)) return bt("troubleshoot.outsideHoursChip");
  return reasonLabel(c.status as ReasonCode);
}

function blockerText(b: TroubleshootBlockerView): string {
  const name = b.title?.trim() || (b.source === "calendar" ? bt("troubleshoot.calendarEvent") : b.source === "reserved" ? bt("troubleshoot.hold") : bt("troubleshoot.meeting"));
  const withInvitees = b.inviteeNames.length ? `${name} (${b.inviteeNames.join(", ")})` : name;
  if (b.bufferSide === "before") return bt("troubleshoot.bufferBefore", { name: withInvitees });
  if (b.bufferSide === "after") return bt("troubleshoot.bufferAfter", { name: withInvitees });
  return withInvitees;
}

export function TroubleshootList({ dateLabel, candidates, formatTime, selected, onSelect, onNext, fullUrl }: TroubleshootListProps) {
  const [open, setOpen] = useState<TroubleshootCandidateView | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef(false);
  useEffect(() => {
    if (focusNext.current && selected) {
      focusNext.current = false;
      nextRef.current?.focus();
    }
  }, [selected]);
  const shown = [...candidates].sort((a, b) => a.start - b.start);
  // A day starts with hours of "Outside hours" starts from midnight: open the list on the first start that matters
  // (available or blocked by something the owner can fix) so the answer is on screen without scrolling.
  const listRef = useRef<HTMLUListElement>(null);
  const firstRelevant = shown.find((c) => !isOutsideHours(c))?.start ?? null;
  useEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const li = firstRelevant === null ? null : ul.querySelector<HTMLElement>(`[data-start="${firstRelevant}"]`);
    ul.scrollTop = li ? Math.max(0, li.offsetTop - 2) : 0;
  }, [dateLabel, firstRelevant]);
  return (
    <div className="flex min-w-0 flex-col pt-7 pb-6 min-[1000px]:pr-6 max-[999px]:px-5 min-[600px]:max-[999px]:px-8" data-testid="troubleshoot-list">
      <h3 className="mb-1 flex h-[38px] shrink-0 items-center text-[16px] leading-6 text-public-text">{dateLabel}</h3>
      <p className="mb-3 text-[13px] leading-5 text-ink-2">{bt("troubleshoot.intro")}</p>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-[14px] text-ink-2">{bt("troubleshoot.none")}</p>
      ) : (
        <ul ref={listRef} aria-label={bt("troubleshoot.title")} className="scrollbar-thin relative -mx-0.5 flex min-w-0 flex-col gap-2.5 overflow-y-auto px-0.5 py-0.5 min-[1000px]:max-h-[450px] min-[1000px]:[@media(min-height:860px)]:max-h-[540px]">
          {shown.map((c) => {
            const iso = new Date(c.start).toISOString();
            const time = formatTime(c.start);
            if (c.available) {
              if (iso === selected) {
                return (
                  <li key={c.start} data-start={c.start} className="flex min-w-0 items-stretch justify-between">
                    <div className="flex h-[52px] w-[48.5%] items-center justify-center rounded-[var(--radius-slot)] bg-[var(--slot-selected)] text-[16px] font-bold text-white">{time}</div>
                    <button
                      ref={nextRef}
                      type="button"
                      onClick={() => onNext(iso)}
                      className="inline-flex h-[52px] w-[48.5%] animate-slide-in-x items-center justify-center rounded-[var(--radius-slot)] bg-brand text-[16px] font-bold text-white shadow-[var(--shadow-next)] hover:brightness-[0.85] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      {bt("page.next")}
                    </button>
                  </li>
                );
              }
              return (
                <li key={c.start} data-start={c.start} className="flex min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      focusNext.current = true;
                      onSelect(iso);
                    }}
                    className="flex h-[52px] w-full items-center justify-center rounded-[var(--radius-slot)] border border-brand bg-public-bg text-[16px] font-bold text-brand-strong hover:shadow-[inset_0_0_0_1px_var(--primary-color)] focus-visible:shadow-[inset_0_0_0_1px_var(--primary-color)] focus-visible:outline-none"
                  >
                    {time}
                  </button>
                </li>
              );
            }
            const label = chipLabel(c);
            return (
              <li key={c.start} data-start={c.start} className="flex min-w-0" data-testid="troubleshoot-unavailable">
                <div className="flex h-[52px] w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-slot)] border border-dashed border-ink-3 bg-public-bg px-3">
                  <span className="text-[15px] font-semibold text-ink-2 tabular-nums">{time}</span>
                  <button
                    type="button"
                    onClick={() => setOpen(c)}
                    aria-label={`${time}: ${label}`}
                    className="max-w-[65%] truncate rounded-full bg-pebble px-2.5 py-1 text-[11px] leading-4 font-bold tracking-[0.4px] text-ink uppercase hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    data-testid="reason-chip"
                  >
                    {label}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Sheet
        open={open !== null}
        onOpenChange={(v) => !v && setOpen(null)}
        title={open ? bt("troubleshoot.reasonFor", { time: formatTime(open.start) }) : bt("troubleshoot.title")}
        size="sm"
      >
        {open && (
          <div className="flex flex-col gap-5" data-testid="troubleshoot-sheet">
            {isOutsideHours(open) && (
              <section className="flex flex-col gap-1.5">
                <span className="self-start rounded-full bg-pebble px-2.5 py-1 text-[11px] font-bold tracking-[0.4px] uppercase">{bt("troubleshoot.outsideHoursChip")}</span>
                <p className="text-[14px] text-ink">{bt("troubleshoot.outsideHoursHint")}</p>
              </section>
            )}
            {open.reasons.map((code) => {
              const hint = reasonHint(code as ReasonCode);
              const blockers = open.blockers.filter((b) => b.code === code);
              return (
                <section key={code} className="flex flex-col gap-1.5">
                  <span className="self-start rounded-full bg-pebble px-2.5 py-1 text-[11px] font-bold tracking-[0.4px] uppercase">{reasonLabel(code as ReasonCode)}</span>
                  <p className="text-[14px] text-ink">{hint.meaning}</p>
                  {hint.fix && (
                    <p className="text-[13px] text-ink-2">
                      <span className="font-semibold">{bt("troubleshoot.fix")}: </span>
                      {hint.fix}
                    </p>
                  )}
                  {blockers.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1">
                      <span className="text-[12px] font-semibold text-ink-2">{bt("troubleshoot.blockedBy")}</span>
                      <ul className="flex flex-col gap-1">
                        {blockers.map((b, i) => (
                          <li key={i} className="text-[13px] text-ink">
                            {blockerText(b)}
                            <span className="text-ink-2">
                              {" "}
                              ({formatTime(b.start)} - {formatTime(b.end)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              );
            })}
            {fullUrl && (
              <Link href={fullUrl as Route} className="text-[14px] font-semibold text-brand-strong hover:underline">
                {bt("troubleshoot.openFull")}
              </Link>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
