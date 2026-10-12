// Calendar view of a schedule (SPEC AV-07; walkthrough 9.2): a month grid where each day lists its effective hours
// (weekly or date-specific, "Unavailable" in gray). Click dates (or drag across several with a mouse) to select them,
// then "Edit date(s)" (creates date-specific hours for exactly those dates) or "Edit all {Weekday}s" (edits the weekly
// hours), then the interval editor and "Apply". "Use weekly hours" removes the selected dates' date-specific hours.
"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MinuteRange, WeeklyHours } from "@/db/types";
import { DateOverridesModal } from "@/components/availability/date-overrides-modal";
import { IntervalList } from "@/components/availability/interval-list";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { dayLabel, monthGrid, monthLabel, shiftMonth, weekdayNames } from "@/components/ui/month-calendar-utils";
import { cn } from "@/lib/cn";
import {
  dayIsValid,
  effectiveHours,
  formatInterval,
  nextInterval,
  WEEKDAY_NAMES,
  weekdayOfDate,
  type DateOverride,
} from "@/lib/availability/intervals";

export type CalendarViewProps = {
  weekly: WeeklyHours;
  overrides: DateOverride[];
  today: string;
  weekStart: 0 | 1;
  hour12: boolean;
  disabled?: boolean;
  onEditDates: (dates: string[], intervals: MinuteRange[]) => Promise<void>;
  onEditWeekday: (day: number, intervals: MinuteRange[]) => void;
  onResetDates: (dates: string[]) => Promise<void>;
};

export function CalendarView({ weekly, overrides, today, weekStart, hour12, disabled, onEditDates, onEditWeekday, onResetDates }: CalendarViewProps) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string[]>([]);
  const [datesOpen, setDatesOpen] = useState(false);
  const [weekdayOpen, setWeekdayOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const drag = useRef<{ anchor: string; base: string[]; moved: boolean } | null>(null);

  const overrideMap = useMemo(() => new Map(overrides.map((o) => [o.date, o.intervals])), [overrides]);
  const rows = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const weekdays = useMemo(() => weekdayNames("en", weekStart), [weekStart]);
  const cells = useMemo(() => rows.flat().filter((d): d is string => Boolean(d)), [rows]);
  const minMonth = today.slice(0, 7);

  useEffect(() => {
    const end = () => {
      drag.current = null;
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  const selectable = (date: string) => date >= today && !disabled;
  const sameWeekday = selected.length > 0 && selected.every((d) => weekdayOfDate(d) === weekdayOfDate(selected[0]!)) ? weekdayOfDate(selected[0]!) : null;
  const selectedOverrides = selected.filter((d) => overrideMap.has(d));

  const toggle = (date: string) => setSelected((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date].sort()));
  const rangeBetween = (a: string, b: string) => {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return cells.filter((d) => d >= lo && d <= hi && selectable(d));
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-title-sm font-bold text-ink" aria-live="polite">
          {monthLabel(month)}
        </h2>
        <div className="flex items-center gap-1">
          <IconButton aria-label="Go to previous month" size="md" disabled={month <= minMonth} onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft aria-hidden="true" />
          </IconButton>
          <IconButton aria-label="Go to next month" size="md" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
        <table aria-label={`${monthLabel(month)} availability`} className="w-full table-fixed border-collapse select-none">
          <thead>
            <tr className="border-b border-line bg-pebble">
              {weekdays.map((w) => (
                <th key={w.long} scope="col" abbr={w.long} className="px-1 py-2 text-center text-body-sm font-semibold text-ink-2 sm:px-2 sm:text-left">
                  {w.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-line last:border-b-0">
                {row.map((date, c) => {
                  if (!date) return <td key={`e${r}-${c}`} aria-hidden="true" className="h-16 border-r border-line bg-canvas last:border-r-0 sm:h-24" />;
                  const { intervals, source } = effectiveHours(weekly, overrideMap, date);
                  const isSelected = selected.includes(date);
                  const enabled = selectable(date);
                  const hoursText = intervals.length ? intervals.map((i) => formatInterval(i, hour12)).join(", ") : "Unavailable";
                  return (
                    <td key={date} className="h-16 min-w-0 border-r border-line p-0 align-top last:border-r-0 sm:h-24">
                      <button
                        type="button"
                        data-date={date}
                        disabled={!enabled}
                        aria-pressed={enabled ? isSelected : undefined}
                        aria-label={`${dayLabel(date)} - ${hoursText}${source === "override" ? " (date-specific hours)" : ""}`}
                        onPointerDown={(e) => {
                          if (!enabled || e.pointerType !== "mouse" || e.button !== 0) return;
                          drag.current = { anchor: date, base: selected, moved: false };
                        }}
                        onPointerEnter={() => {
                          const d = drag.current;
                          if (!d || !enabled || d.anchor === date) return;
                          d.moved = true;
                          setSelected([...new Set([...d.base, ...rangeBetween(d.anchor, date)])].sort());
                        }}
                        onClick={() => {
                          if (drag.current?.moved) return;
                          toggle(date);
                        }}
                        className={cn(
                          "flex h-full w-full flex-col items-stretch gap-1 p-1.5 text-left transition-colors sm:p-2",
                          "focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                          enabled ? "hover:bg-primary-soft" : "cursor-default bg-canvas",
                          isSelected && "bg-primary-soft-2 ring-2 ring-primary ring-inset hover:bg-primary-soft-2",
                        )}
                      >
                        <span className="flex items-center justify-between gap-1">
                          <span
                            className={cn(
                              "inline-flex size-6 items-center justify-center rounded-full text-body-sm font-semibold",
                              date === today ? "bg-primary text-white" : enabled ? "text-ink" : "text-ink-3",
                            )}
                          >
                            {Number(date.slice(8))}
                          </span>
                          {source === "override" && <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" title="Date-specific hours" />}
                        </span>
                        <span className={cn("hidden min-w-0 flex-col text-[12px] leading-4 sm:flex", intervals.length && enabled ? "text-ink" : "text-ink-2")}>
                          {intervals.length === 0 ? (
                            <span>Unavailable</span>
                          ) : (
                            <>
                              {intervals.slice(0, 2).map((i, k) => (
                                <span key={k} className="truncate">
                                  {formatInterval(i, hour12)}
                                </span>
                              ))}
                              {intervals.length > 2 && <span className="text-ink-2">+{intervals.length - 2} more</span>}
                            </>
                          )}
                        </span>
                        <span aria-hidden="true" className={cn("mt-auto h-1 w-full rounded-full sm:hidden", intervals.length ? "bg-primary" : "bg-mist")} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-3 sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
        <p className="text-body-md text-ink-2">
          {selected.length === 0
            ? "Select dates to change their hours. Drag across dates to select several."
            : `${selected.length} ${selected.length === 1 ? "date" : "dates"} selected`}
        </p>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={disabled} onClick={() => setDatesOpen(true)}>
              {selected.length === 1 ? "Edit date" : "Edit dates"}
            </Button>
            {sameWeekday !== null && (
              <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setWeekdayOpen(true)}>
                Edit all {WEEKDAY_NAMES[sameWeekday]}s
              </Button>
            )}
            {selectedOverrides.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                loading={resetting}
                disabled={disabled}
                onClick={async () => {
                  setResetting(true);
                  try {
                    await onResetDates(selectedOverrides);
                    setSelected([]);
                  } catch {
                    // reported by the caller
                  } finally {
                    setResetting(false);
                  }
                }}
              >
                Use weekly hours
              </Button>
            )}
            <Button size="sm" variant="tertiary" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
        )}
      </div>

      <DateOverridesModal
        open={datesOpen}
        onOpenChange={setDatesOpen}
        title={selected.length === 1 ? `Edit ${dayLabel(selected[0]!)}` : `Edit ${selected.length} dates`}
        hideCalendar
        today={today}
        initialDates={selected}
        initialIntervals={selected[0] ? effectiveHours(weekly, overrideMap, selected[0]).intervals : undefined}
        weekStart={weekStart}
        hour12={hour12}
        onApply={async (dates, intervals) => {
          await onEditDates(dates, intervals);
          setSelected([]);
        }}
      />
      {weekdayOpen && sameWeekday !== null && (
        <WeekdayDialog
          day={sameWeekday}
          initial={weekly[sameWeekday] ?? []}
          hour12={hour12}
          onClose={() => setWeekdayOpen(false)}
          onApply={(intervals) => {
            onEditWeekday(sameWeekday, intervals);
            setWeekdayOpen(false);
            setSelected([]);
          }}
        />
      )}
    </div>
  );
}

function WeekdayDialog({ day, initial, hour12, onClose, onApply }: { day: number; initial: MinuteRange[]; hour12: boolean; onClose: () => void; onApply: (intervals: MinuteRange[]) => void }) {
  const [intervals, setIntervals] = useState<MinuteRange[]>(() => initial.map((r) => ({ ...r })));
  const next = nextInterval(intervals);
  const name = WEEKDAY_NAMES[day]!;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Edit all ${name}s`}
      description="Changes your weekly hours. Dates with date-specific hours keep them."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!dayIsValid(intervals)} onClick={() => onApply(intervals)}>
            Apply
          </Button>
        </>
      }
    >
      <p className="mb-3 text-title-sm font-bold text-ink">What hours are you available?</p>
      <IntervalList
        value={intervals}
        onChange={setIntervals}
        hour12={hour12}
        label={name}
        firstRowActions={
          <IconButton aria-label={intervals.length ? "Add new interval" : "Add hours"} size="sm" disabled={!next} onClick={() => next && setIntervals([...intervals, next])}>
            <Plus aria-hidden="true" />
          </IconButton>
        }
      />
    </Dialog>
  );
}
