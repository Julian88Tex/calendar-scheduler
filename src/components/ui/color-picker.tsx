// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// ColorPicker (ARCHITECTURE 20.2, SPEC ET-15): the 10 Calendly swatches plus a custom hex input. The palette lives in
// ./event-colors.ts (server safe).
"use client";

import { cn } from "@/lib/cn";
import { EVENT_COLORS, HEX_COLOR_PATTERN, type ColorSwatch } from "./event-colors";

export type ColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
  swatches?: readonly ColorSwatch[];
  /** Show the "Custom" hex input (default true). */
  allowCustom?: boolean;
  disabled?: boolean;
  className?: string;
  /** Default "Event color". */
  "aria-label"?: string;
};

export function ColorPicker({ value, onChange, swatches = EVENT_COLORS, allowCustom = true, disabled, className, ...aria }: ColorPickerProps) {
  return (
    <div role="radiogroup" aria-label={aria["aria-label"] ?? "Event color"} className={cn("flex flex-wrap items-center gap-2", className)}>
      {swatches.map((s) => (
        <button
          key={s.value}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === s.value}
          aria-label={s.name}
          disabled={disabled}
          onClick={() => onChange(s.value)}
          className={cn("size-8 rounded-full", value.toLowerCase() === s.value && "ring-2 ring-ink ring-offset-2")}
          style={{ backgroundColor: s.value }}
        />
      ))}
      {allowCustom && (
        <label className="flex items-center gap-1 text-body-sm">
          Custom
          <input
            type="text"
            defaultValue={swatches.some((s) => s.value === value.toLowerCase()) ? "" : value}
            placeholder="#8247F5"
            disabled={disabled}
            maxLength={7}
            onBlur={(e) => HEX_COLOR_PATTERN.test(e.target.value) && onChange(e.target.value.toLowerCase())}
            className="h-8 w-24 rounded border border-line px-2"
          />
        </label>
      )}
    </div>
  );
}
