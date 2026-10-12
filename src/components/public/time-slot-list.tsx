// OWNER: foundation-ui.
//
// TimeSlotList (SPEC BK-06, walkthrough 11.3): the times column. A date subtitle ("Wednesday, October 14", 16px,
// 38px tall, sticky on tablet) and a scrollable list of 52px time buttons (1px --primary-color border, bold
// #004EBA-derived text, 4px radius, 10px gaps; hover and focus 2px border). Choosing a time splits it: the selected
// time on rgba(10,37,64,0.5) with white text (48.5%) and the blue "Next" button (48.5%, 3% gap, slide-in from
// translateX(40px)). Choosing another time moves the split. Keyboard: Tab to a time, Enter selects it and focuses
// "Next" (focus also moves there after a click, since the clicked button is replaced); Enter on "Next" continues. Group events can show "{n} spots left" under the time.
"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "../ui/spinner";

export type TimeSlot = {
  /** Stable value (the slot's ISO start). */
  value: string;
  /** "9:00am" or "09:00". */
  label: string;
  /** Second line, for example "3 spots left". */
  detail?: string | null;
  disabled?: boolean;
};

export type TimeSlotListProps = {
  /** "Wednesday, October 14" */
  dateLabel?: string;
  slots: TimeSlot[];
  selected: string | null;
  onSelect: (value: string) => void;
  /** Called by "Next" (unless nextHref is given). */
  onNext?: (value: string) => void;
  /** "Next" navigates to this URL (the details form). */
  nextHref?: (value: string) => string;
  /** Default "Next". */
  nextLabel?: string;
  loading?: boolean;
  /** Shown when there are no slots (default "No times available"). */
  emptyText?: string;
  /** Accessible name of the list (default "Select a time"). */
  "aria-label"?: string;
  className?: string;
  /** Keep the date subtitle visible while the list scrolls (tablet). */
  stickyHeader?: boolean;
  /** Maximum list height on desktop in px (default 450). */
  maxHeight?: number;
};

export function TimeSlotList({
  dateLabel,
  slots,
  selected,
  onSelect,
  onNext,
  nextHref,
  nextLabel = "Next",
  loading,
  emptyText = "No times available",
  className,
  stickyHeader,
  maxHeight = 450,
  ...aria
}: TimeSlotListProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const nextRef = useRef<HTMLElement | null>(null);
  const focusNext = useRef(false);

  useEffect(() => {
    if (focusNext.current && selected) {
      focusNext.current = false;
      nextRef.current?.focus();
    }
  }, [selected]);

  return (
    <div className={cn("flex min-w-0 flex-col pt-7 pb-6 min-[1000px]:pr-6 max-[999px]:px-5 min-[600px]:max-[999px]:px-8", className)}>
      {dateLabel && (
        <h3
          className={cn(
            "mb-2 flex h-[38px] shrink-0 items-center text-[16px] leading-6 font-normal text-public-text",
            stickyHeader && "sticky top-0 z-10 bg-public-bg max-[999px]:shadow-[0_6px_6px_-6px_rgba(10,37,64,0.15)]",
          )}
        >
          {dateLabel}
        </h3>
      )}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner label="Loading times" />
        </div>
      ) : slots.length === 0 ? (
        <p className="py-8 text-center text-[14px] text-ink-2">{emptyText}</p>
      ) : (
        <ul
          aria-label={aria["aria-label"] ?? "Select a time"}
          className="scrollbar-thin -mx-0.5 flex min-w-0 flex-col gap-2.5 overflow-y-auto px-0.5 py-0.5 min-[1000px]:max-h-[var(--slot-list-max)]"
          style={{ ["--slot-list-max" as string]: `${maxHeight}px` }}
        >
          {slots.map((slot) => {
            const isSelected = slot.value === selected;
            const timeId = `${base}-${slot.value.replace(/[^a-zA-Z0-9]/g, "")}`;
            if (isSelected) {
              const nextClass =
                "inline-flex h-[52px] w-[48.5%] animate-slide-in-x items-center justify-center rounded-[var(--radius-slot)] bg-brand text-[16px] font-bold text-white shadow-[var(--shadow-next)] transition-[filter] hover:brightness-[0.85] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
              return (
                <li key={slot.value} className="flex min-w-0 items-stretch justify-between">
                  <div
                    id={timeId}
                    className="flex h-[52px] w-[48.5%] min-w-0 flex-col items-center justify-center rounded-[var(--radius-slot)] bg-[var(--slot-selected)] px-1 text-center text-white"
                  >
                    <span className="truncate text-[16px] leading-5 font-bold">{slot.label}</span>
                    {slot.detail && <span className="truncate text-[12px] leading-4 font-semibold opacity-90">{slot.detail}</span>}
                  </div>
                  {nextHref ? (
                    <Link
                      ref={(el) => {
                        nextRef.current = el;
                      }}
                      href={nextHref(slot.value) as Route}
                      aria-describedby={timeId}
                      className={nextClass}
                      onClick={() => onNext?.(slot.value)}
                    >
                      {nextLabel}
                    </Link>
                  ) : (
                    <button
                      ref={(el) => {
                        nextRef.current = el;
                      }}
                      type="button"
                      aria-describedby={timeId}
                      className={nextClass}
                      onClick={() => onNext?.(slot.value)}
                    >
                      {nextLabel}
                    </button>
                  )}
                </li>
              );
            }
            return (
              <li key={slot.value} className="flex min-w-0">
                <button
                  type="button"
                  disabled={slot.disabled}
                  onClick={() => {
                    // The clicked button is replaced by the split row: keep focus on its "Next" button.
                    focusNext.current = true;
                    onSelect(slot.value);
                  }}
                  className={cn(
                    "flex h-[52px] w-full min-w-0 flex-col items-center justify-center rounded-[var(--radius-slot)] border border-brand bg-public-bg px-2 text-center text-brand-strong",
                    "transition-[box-shadow] duration-100 hover:shadow-[inset_0_0_0_1px_var(--primary-color)] focus-visible:shadow-[inset_0_0_0_1px_var(--primary-color)] focus-visible:outline-none",
                    "disabled:cursor-not-allowed disabled:border-line disabled:text-ink-3 disabled:hover:shadow-none",
                  )}
                >
                  <span className="text-[16px] leading-5 font-bold tabular-nums">{slot.label}</span>
                  {slot.detail && <span className="text-[12px] leading-4 font-semibold text-ink-2">{slot.detail}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
