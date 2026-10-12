// OWNER: foundation-ui.
//
// Input (ARCHITECTURE 20.2, walkthrough 1.4): 8px radius, 1px #D4E0ED border (hover #476788, focus #006BFF with the
// focus ring), 40px in the app and 46px (size="lg") on the booking form; optional static addons inside the field
// (for example the "{host}/" URL prefix). The ref is forwarded to the <input>.
"use client";

import type * as React from "react";
import { cn } from "@/lib/cn";

export type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  size?: "md" | "lg";
  /** Sets aria-invalid and the error border. */
  invalid?: boolean;
  /** Static content before the value (for example the "{host}/" URL prefix). */
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
};

/** Shared field chrome (Input, Textarea, Select triggers, Combobox, TimeInput). */
export const FIELD_BASE =
  "w-full min-w-0 rounded-[var(--radius-input)] border border-line bg-white text-ink transition-colors duration-100 " +
  "hover:border-ink-2 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus " +
  "disabled:cursor-not-allowed disabled:border-line disabled:bg-pebble disabled:text-ink-2 " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:hover:border-danger";

export const FIELD_SIZES = { md: "h-10 px-3 text-[14px]", lg: "h-[46px] px-4 text-[16px]" } as const;

export function Input({ size = "md", invalid, leftAddon, rightAddon, className, ...rest }: InputProps) {
  const hasAddon = Boolean(leftAddon || rightAddon);
  const ariaInvalid = invalid || rest["aria-invalid"] === true || rest["aria-invalid"] === "true" || undefined;
  if (!hasAddon) {
    return <input {...rest} aria-invalid={ariaInvalid} className={cn(FIELD_BASE, FIELD_SIZES[size], className)} />;
  }
  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-center overflow-hidden rounded-[var(--radius-input)] border border-line bg-white transition-colors duration-100",
        "hover:border-ink-2 focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus",
        "has-[:disabled]:bg-pebble",
        ariaInvalid && "border-danger hover:border-danger",
        size === "lg" ? "h-[46px]" : "h-10",
        className,
      )}
    >
      {leftAddon && (
        <span className={cn("flex shrink-0 items-center whitespace-nowrap text-ink-2 select-none", size === "lg" ? "pl-4 text-[16px]" : "pl-3 text-[14px]")}>
          {leftAddon}
        </span>
      )}
      <input
        {...rest}
        aria-invalid={ariaInvalid}
        className={cn(
          "h-full w-full min-w-0 flex-1 bg-transparent text-ink outline-none disabled:cursor-not-allowed",
          size === "lg" ? "text-[16px]" : "text-[14px]",
          leftAddon ? "pl-0.5" : size === "lg" ? "pl-4" : "pl-3",
          rightAddon ? "pr-1" : size === "lg" ? "pr-4" : "pr-3",
        )}
      />
      {rightAddon && (
        <span className={cn("flex shrink-0 items-center text-ink-2", size === "lg" ? "pr-4 text-[16px]" : "pr-3 text-[14px]")}>{rightAddon}</span>
      )}
    </div>
  );
}
