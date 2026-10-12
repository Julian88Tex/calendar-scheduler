// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// DatePicker and DateRangePicker (ARCHITECTURE 20.2). Values are local "YYYY-MM-DD" strings. Foundation stub: native
// date inputs.
"use client";

import { cn } from "@/lib/cn";

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
};

export function DatePicker({ value, onChange, min, max, placeholder, invalid, disabled, id, className, ...aria }: DatePickerProps) {
  return (
    <input
      id={id}
      type="date"
      value={value ?? ""}
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn("h-10 rounded-[var(--radius-input)] border border-line px-3 text-body-md", className)}
      {...aria}
    />
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

export function DateRangePicker({ value, onChange, min, max, presets, disabled, id, className, ...aria }: DateRangePickerProps) {
  return (
    <div id={id} role="group" aria-label={aria["aria-label"] ?? "Date range"} className={cn("flex flex-wrap items-center gap-2", className)}>
      {presets?.map((p) => (
        <button key={p.label} type="button" disabled={disabled} onClick={() => onChange({ start: p.start, end: p.end })} className="text-body-sm text-primary-text">
          {p.label}
        </button>
      ))}
      <DatePicker value={value.start} min={min} max={value.end ?? max} disabled={disabled} aria-label="Start date" onChange={(start) => onChange({ ...value, start })} />
      <span aria-hidden="true">to</span>
      <DatePicker value={value.end} min={value.start ?? min} max={max} disabled={disabled} aria-label="End date" onChange={(end) => onChange({ ...value, end })} />
    </div>
  );
}
