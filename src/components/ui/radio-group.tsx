// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// RadioGroup (ARCHITECTURE 20.2, Radix based in the final version). Foundation stub: native radios in a fieldset.
"use client";

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
};

export function RadioGroup({ value, defaultValue, onValueChange, options, name, orientation = "vertical", disabled, required, className, legend, ...aria }: RadioGroupProps) {
  const generated = useId();
  const groupName = name ?? `rg-${generated}`;
  return (
    <fieldset role="radiogroup" className={cn("flex gap-3", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap", className)} disabled={disabled} {...aria}>
      {legend && <legend className="mb-1 text-label">{legend}</legend>}
      {options.map((o) => {
        const id = `${groupName}-${o.value}`;
        return (
          <div key={o.value} className="flex items-start gap-2">
            <input
              id={id}
              type="radio"
              name={groupName}
              value={o.value}
              required={required}
              disabled={o.disabled}
              checked={value === undefined ? undefined : value === o.value}
              defaultChecked={defaultValue === undefined ? undefined : defaultValue === o.value}
              onChange={() => onValueChange?.(o.value)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <label htmlFor={id} className="text-body-md">
              {o.label}
              {o.description && <span className="block text-body-sm text-ink-2">{o.description}</span>}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}
