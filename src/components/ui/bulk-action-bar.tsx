// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// BulkActionBar (ARCHITECTURE 20.2): "{n} selected" bar with actions and a clear button (lists with selection).
"use client";

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
    <div role="region" aria-label="Bulk actions" className={cn("fixed inset-x-0 bottom-4 z-20 mx-auto flex w-fit items-center gap-3 rounded-full bg-ink px-4 py-2 text-white", className)}>
      <span className="text-body-md">{label ?? `${count} selected`}</span>
      {children}
      <button type="button" onClick={onClear} className="text-body-md underline">
        Clear
      </button>
    </div>
  );
}
