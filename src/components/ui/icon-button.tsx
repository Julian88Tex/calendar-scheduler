// OWNER: foundation-ui.
//
// IconButton (ARCHITECTURE 20.2, walkthrough 1.5): a 32 to 40px circle, transparent with a #476788 icon and a #F4F8FF
// hover fill, with a required accessible name. Works as a Radix trigger (props and ref are forwarded).
"use client";

import type * as React from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export type IconButtonProps = Omit<React.ComponentProps<"button">, "aria-label"> & {
  /** Required accessible name (icon-only control). */
  "aria-label": string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "secondary" | "primary";
  loading?: boolean;
  /** The icon (lucide-react element). */
  children: React.ReactNode;
};

const SIZES = { sm: "size-8 [&_svg]:size-4", md: "size-9 [&_svg]:size-5", lg: "size-10 [&_svg]:size-5" } as const;
const VARIANTS = {
  ghost: "border-transparent bg-transparent text-ink-2 hover:bg-primary-soft hover:text-primary-text active:bg-primary-soft-2",
  secondary: "border-line bg-white text-ink-2 hover:border-ink-2 hover:bg-primary-soft hover:text-primary-text",
  primary: "border-transparent bg-primary text-white hover:bg-primary-hover active:bg-primary-active",
} as const;

export function IconButton({ size = "md", variant = "ghost", loading, className, disabled, children, type, ...rest }: IconButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border transition-colors duration-100",
        "disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0",
        "data-[state=open]:bg-primary-soft data-[state=open]:text-primary-text",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size="sm" inheritColor decorative /> : children}
    </button>
  );
}
