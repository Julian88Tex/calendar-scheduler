// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Input (ARCHITECTURE 20.2): 40px (app) or 46px (size="lg", booking form) height; optional addons inside the field.
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

export function Input({ size = "md", invalid, leftAddon, rightAddon, className, ...rest }: InputProps) {
  const field = (
    <input
      aria-invalid={invalid || rest["aria-invalid"] || undefined}
      className={cn(
        "w-full rounded-[var(--radius-input)] border border-line bg-white px-3 text-body-md text-ink",
        size === "lg" ? "h-[46px]" : "h-10",
        invalid && "border-danger",
        (leftAddon || rightAddon) && "border-0 focus:outline-none",
        !(leftAddon || rightAddon) && className,
      )}
      {...rest}
    />
  );
  if (!leftAddon && !rightAddon) return field;
  return (
    <div className={cn("flex items-center rounded-[var(--radius-input)] border border-line bg-white", invalid && "border-danger", className)}>
      {leftAddon && <span className="pl-3 text-body-md text-ink-2">{leftAddon}</span>}
      {field}
      {rightAddon && <span className="pr-3 text-body-md text-ink-2">{rightAddon}</span>}
    </div>
  );
}
