// WeeklyHoursEditor (SPEC AV-03, AV-04, AV-05; walkthrough 9.2): seven rows starting Sunday or Monday (weekStart),
// each with a 32px navy day circle and either "Unavailable" with "+", or interval rows "9:00am - 5:00pm (x)" whose first
// row also has "+" (add another interval one hour after the last end) and the copy icon ("Copy times to...").
//
// Controlled and save-model agnostic: `onChange` receives every edit (valid or not, valid days sorted). The Schedules
// page auto-saves valid values; the event type editor keeps them until "Save changes". Check validity with
// weeklyIsValid from @/lib/availability/intervals.
//
//   <WeeklyHoursEditor value={weekly} onChange={setWeekly} timeFormat="12h" weekStart={0} />
"use client";

import { Plus, Repeat } from "lucide-react";
import { useId } from "react";
import type { WeeklyHours } from "@/db/types";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { cloneWeekly, copyDayTo, dayOrder, nextInterval, WEEKDAY_INITIALS, WEEKDAY_NAMES } from "@/lib/availability/intervals";
import { CopyTimesPopover } from "./copy-times-popover";
import { IntervalList } from "./interval-list";

export type WeeklyHoursEditorProps = {
  value: WeeklyHours;
  onChange: (next: WeeklyHours) => void;
  /** "12h" (9:00am, default) or "24h" (09:00). */
  timeFormat?: "12h" | "24h";
  /** First day of the week: 0 Sunday (default) or 1 Monday. */
  weekStart?: 0 | 1;
  disabled?: boolean;
  /** Show the "Weekly hours" heading and subtitle (default true). */
  showHeading?: boolean;
  className?: string;
};

export function WeeklyHoursEditor({ value, onChange, timeFormat = "12h", weekStart = 0, disabled, showHeading = true, className }: WeeklyHoursEditorProps) {
  const hour12 = timeFormat !== "24h";
  const headingId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-weekly-hours`;
  const setDay = (day: number, intervals: WeeklyHours[number]) => {
    const next = cloneWeekly(value);
    next[day] = intervals;
    onChange(next);
  };

  return (
    <section className={cn("min-w-0", className)} aria-labelledby={showHeading ? headingId : undefined} aria-label={showHeading ? undefined : "Weekly hours"}>
      {showHeading && (
        <header className="mb-5">
          <h2 id={headingId} className="flex items-center gap-2 text-title-sm font-bold text-ink">
            <Repeat aria-hidden="true" className="size-4 text-ink-2" />
            Weekly hours
          </h2>
          <p className="mt-0.5 text-body-md text-ink-2">Set when you are typically available for meetings</p>
        </header>
      )}
      <ul className="flex flex-col gap-4">
        {dayOrder(weekStart).map((day) => {
          const intervals = value[day] ?? [];
          const name = WEEKDAY_NAMES[day];
          const next = nextInterval(intervals);
          const addButton = (
            <Tooltip content={next ? "Add new interval" : "This day is full"}>
              <IconButton
                aria-label={intervals.length ? `Add new interval to ${name}` : `Add hours to ${name}`}
                size="sm"
                disabled={disabled || !next}
                onClick={() => next && setDay(day, [...intervals.map((r) => ({ ...r })), next])}
              >
                <Plus aria-hidden="true" />
              </IconButton>
            </Tooltip>
          );
          return (
            <li key={day} className="flex min-w-0 items-start gap-3 sm:gap-4" aria-label={name} data-day={day}>
              <span
                aria-hidden="true"
                title={name}
                className="mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-navy text-[12px] font-bold text-white"
              >
                {WEEKDAY_INITIALS[day]}
              </span>
              <span className="sr-only">{name}</span>
              <IntervalList
                className="min-w-0 flex-1"
                value={intervals}
                onChange={(list) => setDay(day, list)}
                hour12={hour12}
                disabled={disabled}
                label={name}
                firstRowActions={
                  <>
                    {addButton}
                    {intervals.length > 0 && (
                      <CopyTimesPopover day={day} weekStart={weekStart} disabled={disabled} onApply={(targets) => onChange(copyDayTo(value, day, targets))} />
                    )}
                  </>
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
