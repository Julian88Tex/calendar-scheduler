// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// MonthCalendar (ARCHITECTURE 20.2, SPEC BK-04, GEN-05): 44px circle days with available, selected and today states
// in --primary-color, single or multiple selection. Dates are local "YYYY-MM-DD" strings and months "YYYY-MM", so the
// component never does time zone math. Used by the booking page, date overrides and the polls month view.
"use client";

import { cn } from "@/lib/cn";

export type MonthCalendarProps = {
  /** Visible month "YYYY-MM". */
  month: string;
  onMonthChange: (month: string) => void;
  mode?: "single" | "multiple";
  /** Selected date(s) "YYYY-MM-DD". */
  selected?: string | string[] | null;
  onSelect?: (date: string) => void;
  /** Dates with availability (bold, selectable). When omitted every non-disabled date is selectable. */
  availableDates?: readonly string[];
  isDisabled?: (date: string) => boolean;
  /** Today's local date (highlighted). */
  today?: string;
  weekStart?: 0 | 1;
  minMonth?: string;
  maxMonth?: string;
  locale?: string;
  loading?: boolean;
  className?: string;
  /** Accessible name of the grid (default "Select a Day"). */
  "aria-label"?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function MonthCalendar({ month, onMonthChange, mode = "single", selected, onSelect, availableDates, isDisabled, today, weekStart = 0, minMonth, maxMonth, locale = "en", loading, className, ...aria }: MonthCalendarProps) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() - weekStart + 7) % 7;
  const selectedSet = new Set(selected == null ? [] : Array.isArray(selected) ? selected : [selected]);
  const available = availableDates ? new Set(availableDates) : null;
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + ((i + weekStart) % 7)))),
  );
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`)];
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-busy={loading || undefined}>
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Go to previous month" disabled={!!minMonth && month <= minMonth} onClick={() => onMonthChange(shiftMonth(month, -1))}>
          &lsaquo;
        </button>
        <span className="text-body-md">{monthLabel}</span>
        <button type="button" aria-label="Go to next month" disabled={!!maxMonth && month >= maxMonth} onClick={() => onMonthChange(shiftMonth(month, 1))}>
          &rsaquo;
        </button>
      </div>
      <div role="grid" aria-label={aria["aria-label"] ?? "Select a Day"} aria-multiselectable={mode === "multiple" || undefined} className="grid grid-cols-7 gap-1 text-center">
        {weekdays.map((w) => (
          <span key={w} role="columnheader" className="text-body-sm text-ink-2">
            {w}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`e${i}`} />;
          const isAvailable = (available ? available.has(date) : true) && !isDisabled?.(date);
          const isSelected = selectedSet.has(date);
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-label={`${new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}${isAvailable ? " - Times available" : " - No times available"}`}
              aria-current={date === today ? "date" : undefined}
              disabled={!isAvailable}
              onClick={() => onSelect?.(date)}
              className={cn(
                "mx-auto size-11 rounded-full text-body-md",
                isAvailable ? "bg-primary-soft-2 font-bold text-[var(--primary-color)]" : "text-ink-3",
                isSelected && "bg-[var(--primary-color)] text-white",
              )}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
