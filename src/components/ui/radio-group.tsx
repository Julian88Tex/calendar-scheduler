// OWNER: foundation-ui.
//
// RadioGroup (ARCHITECTURE 20.2, Radix RadioGroup): 18px circles with a #006BFF dot, arrow-key navigation, optional
// descriptions per option and a visible legend (or aria-label / aria-labelledby).
"use client";

import * as RadixRadio from "@radix-ui/react-radio-group";
import { useId } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type RadioOption = { value: string; label: React.ReactNode; description?: React.ReactNode; disabled?: boolean };

export type RadioGroupProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: RadioOption[];
  name?: string;
  orientation?: "vertical" | "horizontal";
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Visible legend (or use aria-label / aria-labelledby). */
  legend?: React.ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  /** Bordered option cards (booking location choice) instead of plain rows. */
  variant?: "plain" | "cards";
};

export function RadioGroup({
  value,
  defaultValue,
  onValueChange,
  options,
  name,
  orientation = "vertical",
  disabled,
  required,
  className,
  legend,
  variant = "plain",
  ...aria
}: RadioGroupProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const legendId = legend ? `${base}-legend` : undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {legend && (
        <span id={legendId} className="text-label text-ink">
          {legend}
        </span>
      )}
      <RadixRadio.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        name={name}
        orientation={orientation}
        disabled={disabled}
        required={required}
        aria-labelledby={aria["aria-labelledby"] ?? legendId}
        aria-label={aria["aria-label"]}
        aria-describedby={aria["aria-describedby"]}
        className={cn("flex", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap", variant === "cards" ? "gap-2" : "gap-3")}
      >
        {options.map((o) => {
          const id = `${base}-${o.value.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
          return (
            <div
              key={o.value}
              className={cn(
                "flex items-start gap-2.5",
                variant === "cards" &&
                  "rounded-[var(--radius-card)] border border-line p-3 has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary-soft",
              )}
            >
              <RadixRadio.Item
                id={id}
                value={o.value}
                disabled={o.disabled}
                className={cn(
                  "mt-px inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border border-line-medium bg-white transition-colors",
                  "hover:border-ink-2 data-[state=checked]:border-primary disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <RadixRadio.Indicator className="block size-2.5 rounded-full bg-primary" />
              </RadixRadio.Item>
              <label htmlFor={id} className={cn("flex min-w-0 cursor-pointer flex-col gap-0.5 text-[14px] leading-5 text-ink", o.disabled && "cursor-not-allowed text-ink-2")}>
                <span>{o.label}</span>
                {o.description && <span className="text-body-sm text-ink-2">{o.description}</span>}
              </label>
            </div>
          );
        })}
      </RadixRadio.Root>
    </div>
  );
}
