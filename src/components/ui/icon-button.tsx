// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// IconButton (ARCHITECTURE 20.2): 32 to 40px circle with a required accessible name.
"use client";

import type * as React from "react";
import { cn } from "@/lib/cn";

export type IconButtonProps = Omit<React.ComponentProps<"button">, "aria-label"> & {
  /** Required accessible name (icon-only control). */
  "aria-label": string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "secondary" | "primary";
  loading?: boolean;
  /** The icon (lucide-react element). */
  children: React.ReactNode;
};

const SIZES = { sm: "size-8", md: "size-9", lg: "size-10" } as const;
const VARIANTS = {
  ghost: "text-ink-2 hover:bg-pebble",
  secondary: "border border-line bg-white text-ink",
  primary: "bg-primary text-white",
} as const;

export function IconButton({ size = "md", variant = "ghost", loading, className, disabled, children, type, ...rest }: IconButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cn("inline-flex items-center justify-center rounded-full disabled:opacity-50", SIZES[size], VARIANTS[variant], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
