// OWNER: foundation-ui.
//
// Badge (ARCHITECTURE 20.2, walkthrough 1.5): pill badges, neutral, info (#E6F0FF with #004EBA text, "Secret",
// "Default"), success, warning, danger, outline. Server and client safe.
import type * as React from "react";
import { cn } from "@/lib/cn";

export type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger" | "outline";

export type BadgeProps = React.ComponentProps<"span"> & { variant?: BadgeVariant; size?: "sm" | "md"; icon?: React.ReactNode };

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: "bg-mist text-ink",
  info: "bg-info-soft text-primary-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
  outline: "border border-line-medium bg-transparent text-ink-2",
};

export function Badge({ variant = "neutral", size = "md", icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-semibold whitespace-nowrap [&_svg]:size-3",
        size === "sm" ? "h-[18px] px-1.5 text-[11px] leading-4" : "h-[22px] px-2 text-[12px] leading-4",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
