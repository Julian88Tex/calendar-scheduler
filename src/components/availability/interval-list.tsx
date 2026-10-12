// IntervalList (SPEC AV-03, AV-04, AV-06): the rows of one day's hours, "9:00am - 5:00pm (x)", with typeable 15-minute
// time comboboxes (TimeInput accepts "9", "930", "9:30 pm", "21:30" and any minute), inline AV-04 errors under the
// offending row, and an "Unavailable" state when the day has no rows. Shared by the weekly hours editor, the
// date-specific hours modal and the calendar view editor. Controlled: `onChange` receives every edit, valid or not;
// valid days come back sorted (settleDay).
"use client";

import { X } from "lucide-react";
import type * as React from "react";
import { useId } from "react";
import type { MinuteRange } from "@/db/types";
import { IconButton } from "@/components/ui/icon-button";
import { TimeInput } from "@/components/ui/time-input";
import { cn } from "@/lib/cn";
import { formatInterval, intervalErrors, settleDay } from "@/lib/availability/intervals";

export type IntervalListProps = {
  value: MinuteRange[];
  onChange: (next: MinuteRange[]) => void;
  hour12?: boolean;
  disabled?: boolean;
  /** Accessible name of the day ("Monday", "Thu, Oct 22, 2026"). */
  label: string;
  /** Extra controls next to the first row ("+" and copy in the weekly editor). */
  firstRowActions?: React.ReactNode;
  /** Shown instead of rows when the day has none (default "Unavailable"). */
  emptyLabel?: React.ReactNode;
  className?: string;
};

export function IntervalList({ value, onChange, hour12 = true, disabled, label, firstRowActions, emptyLabel = "Unavailable", className }: IntervalListProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const errors = intervalErrors(value);

  const update = (index: number, patch: Partial<MinuteRange>) => {
    const next = value.map((r, i) => (i === index ? { ...r, ...patch } : { ...r }));
    onChange(settleDay(next));
  };
  const remove = (index: number) => onChange(settleDay(value.filter((_, i) => i !== index)));

  if (value.length === 0) {
    return (
      <div className={cn("flex min-h-10 items-center gap-2", className)}>
        <span className="text-body-md text-ink-2">{emptyLabel}</span>
        {firstRowActions && <div className="ml-auto flex items-center gap-1 sm:ml-2">{firstRowActions}</div>}
      </div>
    );
  }

  return (
    <ul className={cn("flex min-w-0 flex-col gap-2", className)} aria-label={`${label} hours`}>
      {value.map((r, i) => {
        const error = errors[i];
        const errorId = `${base}-err-${i}`;
        const n = value.length > 1 ? ` ${i + 1}` : "";
        return (
          <li key={i} className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
              <TimeInput
                value={r.start}
                onChange={(m) => m !== null && update(i, { start: m })}
                hour12={hour12}
                max={1439}
                disabled={disabled}
                invalid={Boolean(error)}
                aria-label={`${label} start time${n}`}
                aria-describedby={error ? errorId : undefined}
                className="w-[104px] sm:w-28"
              />
              <span aria-hidden="true" className="text-ink-2">
                -
              </span>
              <TimeInput
                value={r.end}
                onChange={(m) => m !== null && update(i, { end: m })}
                hour12={hour12}
                min={1}
                allowEndOfDay
                disabled={disabled}
                invalid={Boolean(error)}
                aria-label={`${label} end time${n}`}
                aria-describedby={error ? errorId : undefined}
                className="w-[104px] sm:w-28"
              />
              <IconButton
                aria-label={`Remove ${formatInterval(r, hour12)} from ${label}`}
                size="sm"
                disabled={disabled}
                onClick={() => remove(i)}
              >
                <X aria-hidden="true" />
              </IconButton>
              {i === 0 && firstRowActions && <div className="flex items-center gap-1">{firstRowActions}</div>}
            </div>
            {error && (
              <p id={errorId} role="alert" className="text-body-sm font-semibold text-danger-text">
                {error}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
