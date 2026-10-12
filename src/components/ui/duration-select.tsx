// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// DurationSelect (ARCHITECTURE 20.2): presets (15, 30, 45, 60 min) plus a custom duration in min or hrs.
"use client";

import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/time/format";

export type DurationSelectProps = {
  /** Minutes. */
  value: number;
  onChange: (minutes: number) => void;
  presets?: number[];
  /** Default 1. */
  min?: number;
  /** Default 720 (event_types_duration_ck). */
  max?: number;
  allowCustom?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
};

export function DurationSelect({ value, onChange, presets = [15, 30, 45, 60], min = 1, max = 720, allowCustom = true, disabled, id, className, ...aria }: DurationSelectProps) {
  const isPreset = presets.includes(value);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <select
        id={id}
        value={isPreset ? String(value) : "custom"}
        disabled={disabled}
        aria-label={aria["aria-label"] ?? "Duration"}
        onChange={(e) => e.target.value !== "custom" && onChange(Number(e.target.value))}
        className="h-10 rounded-[var(--radius-input)] border border-line px-3 text-body-md"
      >
        {presets.map((p) => (
          <option key={p} value={p}>
            {formatDuration(p)}
          </option>
        ))}
        {allowCustom && <option value="custom">Custom</option>}
      </select>
      {allowCustom && !isPreset && (
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          aria-label="Custom duration in minutes"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= min && n <= max) onChange(n);
          }}
          className="h-10 w-24 rounded-[var(--radius-input)] border border-line px-3"
        />
      )}
    </div>
  );
}
