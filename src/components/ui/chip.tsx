// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Chip (ARCHITECTURE 20.2): a pill value with an optional remove button.
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

export function Chip({ children, onRemove, removeLabel = "Remove", icon, variant = "neutral", disabled, className }: ChipProps) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-body-sm", variant === "primary" ? "bg-primary-soft-2 text-primary-text" : variant === "danger" ? "bg-[var(--danger-soft)] text-danger-text" : "bg-pebble text-ink", className)}>
      {icon}
      {children}
      {onRemove && (
        <button type="button" aria-label={removeLabel} disabled={disabled} onClick={onRemove} className="rounded-full p-0.5 hover:bg-mist">
          <X aria-hidden="true" className="size-3" />
        </button>
      )}
    </span>
  );
}
