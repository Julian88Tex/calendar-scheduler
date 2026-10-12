// OWNER: foundation-ui.
//
// Chip (ARCHITECTURE 20.2): a pill value (tags, email chips, filters) with an optional remove button (its accessible
// name defaults to "Remove").
"use client";

import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type ChipProps = {
  children: React.ReactNode;
  onRemove?: () => void;
  /** Accessible name of the remove button (default "Remove"). */
  removeLabel?: string;
  icon?: React.ReactNode;
  variant?: "neutral" | "primary" | "danger";
  disabled?: boolean;
  className?: string;
};

const VARIANTS = {
  neutral: "bg-mist text-ink",
  primary: "bg-primary-soft-2 text-primary-text",
  danger: "bg-danger-soft text-danger-text",
} as const;

export function Chip({ children, onRemove, removeLabel = "Remove", icon, variant = "neutral", disabled, className }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full py-1 text-[13px] leading-[18px] font-semibold [&_svg]:size-3.5",
        onRemove ? "pr-1 pl-2.5" : "px-2.5",
        VARIANTS[variant],
        disabled && "opacity-60",
        className,
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          disabled={disabled}
          onClick={onRemove}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-black/10 disabled:cursor-not-allowed"
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      )}
    </span>
  );
}
