// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Textarea (ARCHITECTURE 20.2) with an optional live character counter.
"use client";

import type * as React from "react";
import { cn } from "@/lib/cn";

export type TextareaProps = React.ComponentProps<"textarea"> & {
  invalid?: boolean;
  /** Grow with the content (foundation-ui). */
  autoResize?: boolean;
  /** Shows "{length}/{maxLength}" below the field (requires maxLength). */
  showCount?: boolean;
};

export function Textarea({ invalid, autoResize: _autoResize, showCount, className, maxLength, value, defaultValue, ...rest }: TextareaProps) {
  const length = String(value ?? defaultValue ?? "").length;
  return (
    <div className="w-full">
      <textarea
        aria-invalid={invalid || undefined}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        className={cn("min-h-24 w-full rounded-[var(--radius-input)] border border-line bg-white p-3 text-body-md", invalid && "border-danger", className)}
        {...rest}
      />
      {showCount && maxLength ? (
        <p className="text-right text-body-sm text-ink-2" aria-live="polite">
          {length}/{maxLength}
        </p>
      ) : null}
    </div>
  );
}
