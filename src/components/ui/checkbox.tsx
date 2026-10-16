// OWNER: foundation-ui.
//
// Checkbox (ARCHITECTURE 20.2, walkthrough 1.5, Radix Checkbox): 18px box with a small radius, #006BFF fill and a white
// check when checked, a dash when indeterminate; optional label and description (the whole row is clickable).
"use client";

import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { useId } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type CheckboxProps = {
  checked?: boolean | "indeterminate";
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  value?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export function Checkbox({ checked, defaultChecked, onCheckedChange, label, description, id, className, disabled, ...rest }: CheckboxProps) {
  const generated = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const inputId = id ?? `cb-${generated}`;
  const descId = description ? `${inputId}-desc` : undefined;
  const describedBy = [rest["aria-describedby"], descId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <RadixCheckbox.Root
        id={inputId}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange?.(v === true)}
        {...rest}
        aria-describedby={describedBy}
        className={cn(
          "peer mt-px inline-flex size-[18px] shrink-0 items-center justify-center rounded-[3px] border border-line-medium bg-white text-white",
          "transition-colors duration-100 hover:border-ink-2",
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
          "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger",
        )}
      >
        <RadixCheckbox.Indicator className="flex items-center justify-center">
          {checked === "indeterminate" ? <Minus aria-hidden="true" className="size-3.5" strokeWidth={3} /> : <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />}
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {(label || description) && (
        <span className="flex min-w-0 flex-col gap-0.5">
          {label && (
            <label htmlFor={inputId} className={cn("cursor-pointer text-[14px] leading-5 text-ink", disabled && "cursor-not-allowed text-ink-2")}>
              {label}
            </label>
          )}
          {description && (
            <span id={descId} className="text-body-sm text-ink-2">
              {description}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
