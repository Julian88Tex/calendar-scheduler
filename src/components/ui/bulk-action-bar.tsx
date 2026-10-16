// OWNER: foundation-ui.
//
// BulkActionBar (ARCHITECTURE 20.2, walkthrough 5.1): the floating "{n} selected" toolbar at the bottom of lists with
// selection, its actions and a "Clear" button; announced when it appears. Navy bar, pill buttons inside.
"use client";

import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type BulkActionBarProps = {
  count: number;
  onClear: () => void;
  /** Action buttons. */
  children: React.ReactNode;
  /** Default "{count} selected". */
  label?: string;
  className?: string;
};

export function BulkActionBar({ count, onClear, children, label, className }: BulkActionBarProps) {
  if (count <= 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className={cn(
        "fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-max flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] bg-[#0a2540] px-4 py-2.5 text-white shadow-[var(--shadow-pop)] animate-toast-in",
        "[&_button]:text-white",
        className,
      )}
    >
      <span className="text-[14px] font-semibold" aria-live="polite">
        {label ?? `${count} selected`}
      </span>
      <span aria-hidden="true" className="h-5 w-px bg-white/25" />
      <div className="flex flex-wrap items-center gap-1 [&_button]:rounded-full [&_button:hover]:bg-white/10">{children}</div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[14px] font-semibold hover:bg-white/10 focus-visible:outline-white"
      >
        <X aria-hidden="true" className="size-4" />
        Clear
      </button>
    </div>
  );
}
