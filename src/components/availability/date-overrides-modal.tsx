// The "+ Hours" modal (SPEC AV-06; walkthrough 9.2): "Select the date(s) you want to assign specific hours" with a
// multi-select month calendar (today dot, previous and next arrows, past dates disabled), then "What hours are you
// available?" with interval rows ("+" and "x"; removing every row means Unavailable), and "Cancel" / "Apply".
"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import type { MinuteRange } from "@/db/types";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Dialog } from "@/components/ui/dialog";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { dayIsValid, DEFAULT_DAY_INTERVAL, nextInterval } from "@/lib/availability/intervals";
import { IntervalList } from "./interval-list";

export type DateOverridesModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Today in the schedule's zone; earlier dates are disabled. */
  today: string;
  /** Dates selected when the modal opens (editing one override: that date). */
  initialDates?: string[];
  /** Hours shown when the modal opens (default 9:00am to 5:00pm). */
  initialIntervals?: MinuteRange[];
  weekStart?: 0 | 1;
  hour12?: boolean;
  /** Called with the selected dates (sorted) and the hours (empty = unavailable). */
  onApply: (dates: string[], intervals: MinuteRange[]) => void | Promise<void>;
  /** Title override (the calendar view's "Edit date(s)"). */
  title?: string;
  /** Hide the calendar (the dates were chosen elsewhere). */
  hideCalendar?: boolean;
};

export function DateOverridesModal(props: DateOverridesModalProps) {
  // Mounted only while open, so every opening starts from the given dates and hours.
  return props.open ? <OpenModal {...props} /> : null;
}

function OpenModal({ today, initialDates, initialIntervals, weekStart = 0, hour12 = true, onApply, onOpenChange, hideCalendar, title }: DateOverridesModalProps) {
  const [dates, setDates] = useState<string[]>(() => [...new Set(initialDates ?? [])].sort());
  const [month, setMonth] = useState(() => (dates[0] ?? today).slice(0, 7));
  const [intervals, setIntervals] = useState<MinuteRange[]>(() => (initialIntervals ? initialIntervals.map((r) => ({ ...r })) : [{ ...DEFAULT_DAY_INTERVAL }]));
  const [busy, setBusy] = useState(false);
  const valid = dayIsValid(intervals);
  const next = nextInterval(intervals);

  const toggle = (date: string) => setDates((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date].sort()));

  return (
    <Dialog
      open
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={title ?? "Select the date(s) you want to assign specific hours"}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={dates.length === 0 || !valid}
            onClick={async () => {
              setBusy(true);
              try {
                await onApply(dates, intervals);
                onOpenChange(false);
              } catch {
                // The caller reports the failure (toast); keep the modal open for another try.
              } finally {
                setBusy(false);
              }
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {!hideCalendar && (
          <div className="mx-auto w-full max-w-[360px]">
            <MonthCalendar
              month={month}
              onMonthChange={setMonth}
              mode="multiple"
              selected={dates}
              onSelect={toggle}
              today={today}
              minDate={today}
              minMonth={today.slice(0, 7)}
              weekStart={weekStart}
              aria-label="Select the date(s) you want to assign specific hours"
              labels={{ available: "", unavailable: "" }}
            />
            <p className="mt-2 text-center text-body-sm text-ink-2" aria-live="polite">
              {dates.length === 0 ? "No dates selected" : `${dates.length} ${dates.length === 1 ? "date" : "dates"} selected`}
            </p>
          </div>
        )}
        <div className={hideCalendar ? undefined : "border-t border-line pt-5"}>
          <p className="mb-3 text-title-sm font-bold text-ink">What hours are you available?</p>
          <IntervalList
            value={intervals}
            onChange={setIntervals}
            hour12={hour12}
            label="Selected dates"
            firstRowActions={
              <IconButton aria-label={intervals.length ? "Add new interval" : "Add hours"} size="sm" disabled={!next} onClick={() => next && setIntervals([...intervals, next])}>
                <Plus aria-hidden="true" />
              </IconButton>
            }
          />
        </div>
      </div>
    </Dialog>
  );
}
