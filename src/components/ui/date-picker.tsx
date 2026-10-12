// OWNER: foundation-ui.
//
// DatePicker and DateRangePicker (ARCHITECTURE 20.2): an input-style trigger with a calendar icon that opens a popover
// with the MonthCalendar (36px days). Values are local "YYYY-MM-DD" strings. DateRangePicker: the first click sets the
// start, the second the end (earlier dates restart the range), optional presets and a maximum length (analytics: 366
// days).
"use client";

import { CalendarDays, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { FIELD_BASE } from "./input";
import { MonthCalendar } from "./month-calendar";
import { addDays, daysBetween, monthOf, shortDateLabel, todayIn } from "./month-calendar-utils";
import { Popover } from "./popover";

export type DatePickerProps = {
  value: string | null;
  onChange: (date: string | null) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  weekStart?: 0 | 1;
  locale?: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  /** Show a clear button when a date is set (default false). */
  clearable?: boolean;
  /** Disable specific dates. */
  isDisabled?: (date: string) => boolean;
};

const DAY_LABELS = { available: "", unavailable: "Not available" };

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Select a date",
  weekStart = 0,
  locale = "en",
  invalid,
  disabled,
  id,
  className,
  clearable,
  isDisabled,
  ...aria
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [today] = useState(() => todayIn());
  const [month, setMonth] = useState(() => monthOf(value ?? (min && today < min ? min : today)));
  return (
    <span className={cn("relative inline-flex w-full min-w-0 sm:w-56", className)}>
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (v) setMonth(monthOf(value ?? (min && today < min ? min : today)));
        }}
        align="start"
        className="w-[300px] p-3"
        trigger={
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-haspopup="dialog"
            data-invalid={invalid || undefined}
            aria-label={aria["aria-label"] ? `${aria["aria-label"]}${value ? `, ${shortDateLabel(value, locale)}` : ""}` : undefined}
            aria-describedby={aria["aria-describedby"]}
            className={cn(FIELD_BASE, "inline-flex h-10 items-center gap-2 px-3 text-left text-[14px]", clearable && value && "pr-9", invalid && "border-danger hover:border-danger")}
          >
            <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
            <span className={cn("min-w-0 flex-1 truncate", !value && "text-ink-2")}>{value ? shortDateLabel(value, locale) : placeholder}</span>
          </button>
        }
      >
        <MonthCalendar
          size="sm"
          month={month}
          onMonthChange={setMonth}
          selected={value}
          today={today}
          weekStart={weekStart}
          locale={locale}
          minDate={min}
          maxDate={max}
          minMonth={min ? monthOf(min) : undefined}
          maxMonth={max ? monthOf(max) : undefined}
          isDisabled={isDisabled}
          labels={DAY_LABELS}
          aria-label={aria["aria-label"] ?? "Choose a date"}
          onSelect={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
      </Popover>
      {clearable && value && !disabled && (
        <button
          type="button"
          aria-label="Clear date"
          onClick={() => onChange(null)}
          className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 hover:bg-primary-soft hover:text-primary-text"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </span>
  );
}

export type DateRange = { start: string | null; end: string | null };

export type DateRangePickerProps = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  min?: string;
  max?: string;
  /** Longest allowed range in days (analytics: 366). */
  maxDays?: number;
  presets?: { label: string; start: string; end: string }[];
  weekStart?: 0 | 1;
  locale?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
};

/** Applies a click to a range selection: start, then end (an earlier click restarts). */
export function nextRange(current: DateRange, clicked: string): DateRange {
  if (!current.start || current.end) return { start: clicked, end: null };
  if (clicked < current.start) return { start: clicked, end: null };
  return { start: current.start, end: clicked };
}

export function formatRangeLabel(range: DateRange, locale = "en"): string | null {
  if (!range.start) return null;
  if (!range.end) return `${shortDateLabel(range.start, locale)} -`;
  return `${shortDateLabel(range.start, locale)} - ${shortDateLabel(range.end, locale)}`;
}

export function DateRangePicker({ value, onChange, min, max, maxDays, presets, weekStart = 0, locale = "en", disabled, id, className, ...aria }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [today] = useState(() => todayIn());
  const [draft, setDraft] = useState<DateRange>(value);
  const [month, setMonth] = useState(() => monthOf(value.start ?? today));
  const label = formatRangeLabel(value, locale);
  const picking = Boolean(draft.start && !draft.end);
  const limitMax = picking && maxDays && draft.start ? addDays(draft.start, maxDays - 1) : undefined;
  const effectiveMax = limitMax && (!max || limitMax < max) ? limitMax : max;
  const name = aria["aria-label"] ?? "Date range";
  return (
    <div id={id} role="group" aria-label={name} className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (v) {
            setDraft(value);
            setMonth(monthOf(value.start ?? today));
          }
        }}
        align="start"
        className="flex w-auto max-w-[calc(100vw-16px)] flex-col gap-3 p-3 sm:flex-row"
        trigger={
          <button
            type="button"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-label={label ? `${name}, ${label}` : name}
            className={cn(FIELD_BASE, "inline-flex h-10 w-full items-center gap-2 px-3 text-left text-[14px] sm:w-auto sm:min-w-64")}
          >
            <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
            <span className={cn("min-w-0 flex-1 truncate", !label && "text-ink-2")}>{label ?? "Select dates"}</span>
          </button>
        }
      >
        {presets && presets.length > 0 && (
          <ul className="flex flex-row flex-wrap gap-1 sm:w-40 sm:flex-col sm:border-r sm:border-line sm:pr-3" aria-label="Presets">
            {presets.map((p) => {
              const active = value.start === p.start && value.end === p.end;
              return (
                <li key={p.label}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      onChange({ start: p.start, end: p.end });
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full rounded-full px-3 py-1.5 text-left text-[14px] whitespace-nowrap hover:bg-primary-soft",
                      active ? "bg-primary-soft font-semibold text-primary-text" : "text-ink",
                    )}
                  >
                    {p.label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="w-[276px] max-w-full">
          <MonthCalendar
            size="sm"
            month={month}
            onMonthChange={setMonth}
            selected={[draft.start, draft.end].filter((d): d is string => Boolean(d))}
            mode="multiple"
            range={draft}
            today={today}
            weekStart={weekStart}
            locale={locale}
            minDate={picking ? draft.start ?? min : min}
            maxDate={effectiveMax}
            minMonth={min ? monthOf(min) : undefined}
            maxMonth={max ? monthOf(max) : undefined}
            labels={DAY_LABELS}
            aria-label={picking ? "Choose the end date" : "Choose the start date"}
            onSelect={(d) => {
              const next = nextRange(draft, d);
              setDraft(next);
              if (next.start && next.end) {
                onChange(next);
                setOpen(false);
              }
            }}
          />
          <p className="mt-2 text-body-sm text-ink-2" aria-live="polite">
            {picking ? "Select the end date." : "Select the start date."}
            {maxDays ? ` Up to ${maxDays} days.` : ""}
          </p>
        </div>
      </Popover>
      {value.start && value.end && daysBetween(value.start, value.end) >= 0 && (
        <span className="sr-only">{`${daysBetween(value.start, value.end) + 1} days selected`}</span>
      )}
    </div>
  );
}
