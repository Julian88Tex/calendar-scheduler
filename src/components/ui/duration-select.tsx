// OWNER: foundation-ui.
//
// DurationSelect (ARCHITECTURE 20.2, SPEC ET-16): presets (15, 30, 45, 60 min) plus "Custom" with a number and a
// min / hrs unit. Values are whole minutes within [min, max] (default 1 to 720, event_types_duration_ck); out of range
// custom input shows an inline error and is not emitted.
"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/time/format";
import { FIELD_BASE } from "./input";
import { NativeSelect } from "./native-select";
import { Select } from "./select";

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

/** Minutes from a custom amount and unit, or null when it is not a whole number of minutes in range. */
export function customDurationMinutes(amount: string, unit: "min" | "hrs", min = 1, max = 720): number | null {
  const n = Number(amount.replace(",", "."));
  if (!amount.trim() || !Number.isFinite(n)) return null;
  const minutes = unit === "hrs" ? n * 60 : n;
  if (!Number.isInteger(Math.round(minutes * 1000) / 1000) || Math.abs(minutes - Math.round(minutes)) > 1e-9) return null;
  const rounded = Math.round(minutes);
  return rounded >= min && rounded <= max ? rounded : null;
}

export function DurationSelect({ value, onChange, presets = [15, 30, 45, 60], min = 1, max = 720, allowCustom = true, disabled, id, className, ...aria }: DurationSelectProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const isPreset = presets.includes(value);
  const [customMode, setCustomMode] = useState(!isPreset);
  const showCustom = allowCustom && (customMode || !isPreset);
  const [unit, setUnit] = useState<"min" | "hrs">(value >= 60 && value % 60 === 0 && !isPreset ? "hrs" : "min");
  const [amount, setAmount] = useState<string | null>(null);
  const shownAmount = amount ?? String(unit === "hrs" ? value / 60 : value);
  const parsed = amount === null ? value : customDurationMinutes(amount, unit, min, max);
  const error = showCustom && amount !== null && parsed === null ? `Enter a duration between ${formatDuration(min)} and ${formatDuration(max)}.` : null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <Select
        id={id}
        value={showCustom ? "custom" : String(value)}
        disabled={disabled}
        aria-label={aria["aria-label"] ?? "Duration"}
        onValueChange={(v) => {
          if (v === "custom") {
            setCustomMode(true);
            setAmount(null);
            return;
          }
          setCustomMode(false);
          setAmount(null);
          onChange(Number(v));
        }}
        options={[
          ...presets.map((p) => ({ value: String(p), label: formatDuration(p) })),
          ...(allowCustom ? [{ value: "custom", label: "Custom" }] : []),
        ]}
      />
      {showCustom && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              id={`${base}-amount`}
              type="number"
              inputMode="decimal"
              min={unit === "hrs" ? min / 60 : min}
              max={unit === "hrs" ? max / 60 : max}
              step={unit === "hrs" ? 0.25 : 1}
              value={shownAmount}
              disabled={disabled}
              aria-label="Custom duration"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${base}-error` : undefined}
              onChange={(e) => {
                setAmount(e.target.value);
                const next = customDurationMinutes(e.target.value, unit, min, max);
                if (next !== null && next !== value) onChange(next);
              }}
              onBlur={() => {
                if (customDurationMinutes(shownAmount, unit, min, max) !== null) setAmount(null);
              }}
              className={cn(FIELD_BASE, "h-10 w-24 px-3 text-[14px]")}
            />
            <NativeSelect
              aria-label="Duration unit"
              value={unit}
              disabled={disabled}
              className="w-24"
              onChange={(e) => {
                const nextUnit = e.target.value === "hrs" ? "hrs" : "min";
                setUnit(nextUnit);
                setAmount(String(nextUnit === "hrs" ? Math.round((value / 60) * 100) / 100 : value));
              }}
              options={[
                { value: "min", label: "min" },
                { value: "hrs", label: "hrs" },
              ]}
            />
          </div>
          {error && (
            <p id={`${base}-error`} role="alert" className="text-body-sm font-semibold text-danger-text">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
