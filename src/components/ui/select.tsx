// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Select (ARCHITECTURE 20.2, Radix based in the final version): a single choice from options or option groups.
// Foundation stub: a native <select> with the same props.
"use client";

import type * as React from "react";
import { cn } from "@/lib/cn";

export type SelectOption = { value: string; label: React.ReactNode; disabled?: boolean; description?: React.ReactNode; textValue?: string };
export type SelectOptionGroup = { label: string; options: SelectOption[] };

export type SelectProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: (SelectOption | SelectOptionGroup)[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  invalid?: boolean;
  size?: "md" | "lg";
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

const isGroup = (o: SelectOption | SelectOptionGroup): o is SelectOptionGroup => "options" in o;
const text = (o: SelectOption) => o.textValue ?? (typeof o.label === "string" ? o.label : o.value);

export function Select({ value, defaultValue, onValueChange, options, placeholder, invalid, size = "md", className, ...rest }: SelectProps) {
  return (
    <select
      value={value}
      defaultValue={defaultValue}
      onChange={(e) => onValueChange?.(e.target.value)}
      aria-invalid={invalid || undefined}
      className={cn("w-full rounded-[var(--radius-input)] border border-line bg-white px-3 text-body-md", size === "lg" ? "h-[46px]" : "h-10", className)}
      {...rest}
    >
      {placeholder !== undefined && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) =>
        isGroup(o) ? (
          <optgroup key={o.label} label={o.label}>
            {o.options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {text(opt)}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {text(o)}
          </option>
        ),
      )}
    </select>
  );
}
