// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Badge (ARCHITECTURE 20.2): neutral, info, success, warning, danger, outline.
import type * as React from "react";
import { cn } from "@/lib/cn";

export type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger" | "outline";

export type BadgeProps = React.ComponentProps<"span"> & { variant?: BadgeVariant; size?: "sm" | "md"; icon?: React.ReactNode };

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: "bg-pebble text-ink",
  info: "bg-[var(--info-soft)] text-primary-text",
  success: "bg-[var(--success-soft)] text-[var(--success-text)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning-text)]",
  danger: "bg-[var(--danger-soft)] text-danger-text",
  outline: "border border-line text-ink-2",
};

export function Badge({ variant = "neutral", size = "md", icon, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full font-semibold", size === "sm" ? "px-1.5 text-[11px]" : "px-2 py-0.5 text-body-sm", VARIANTS[variant], className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}
