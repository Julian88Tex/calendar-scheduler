// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Checkbox (ARCHITECTURE 20.2, Radix based in the final version) with an optional label and description.
// Foundation stub: a native checkbox.
"use client";

import { useEffect, useId, useRef } from "react";
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
};

export function Checkbox({ checked, defaultChecked, onCheckedChange, label, description, id, className, ...rest }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? `cb-${generated}`;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = checked === "indeterminate";
  }, [checked]);
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className="mt-0.5 size-4 accent-[var(--primary)]"
        checked={checked === undefined ? undefined : checked === true}
        defaultChecked={defaultChecked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...rest}
      />
      {(label || description) && (
        <label htmlFor={inputId} className="text-body-md text-ink">
          {label}
          {description && <span className="block text-body-sm text-ink-2">{description}</span>}
        </label>
      )}
    </div>
  );
}
