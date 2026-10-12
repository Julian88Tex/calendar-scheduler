// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// SegmentedControl (ARCHITECTURE 20.2): List/Calendar, am/pm 24h. A radiogroup of buttons.
"use client";

import type * as React from "react";
import { cn } from "@/lib/cn";

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode; icon?: React.ReactNode; "aria-label"?: string; disabled?: boolean };

export type SegmentedControlProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  "aria-label": string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
};

export function SegmentedControl<T extends string>({ value, onValueChange, options, size = "md", disabled, className, ...aria }: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-full border border-line p-0.5", className)} {...aria}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o["aria-label"]}
          disabled={disabled || o.disabled}
          onClick={() => onValueChange(o.value)}
          className={cn("inline-flex items-center gap-1 rounded-full px-3", size === "sm" ? "h-7 text-body-sm" : "h-8 text-body-md", value === o.value ? "bg-primary text-white" : "text-ink")}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
