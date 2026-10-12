// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Pagination (ARCHITECTURE 20.2): "Previous / Next" with an optional "1-25 of 120" summary. Works with page links
// (hrefForPage, server rendered lists) or callbacks (onPageChange).
"use client";

import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/cn";

export type PaginationProps = {
  /** 1-based page. */
  page: number;
  pageSize: number;
  /** Total rows when known (shows "x-y of total"). */
  total?: number | null;
  /** Whether a next page exists (keyset pagination without a total). */
  hasNext?: boolean;
  onPageChange?: (page: number) => void;
  hrefForPage?: (page: number) => Route;
  className?: string;
  "aria-label"?: string;
};

export function Pagination({ page, pageSize, total, hasNext, onPageChange, hrefForPage, className, ...aria }: PaginationProps) {
  const from = (page - 1) * pageSize + 1;
  const to = total != null ? Math.min(page * pageSize, total) : page * pageSize;
  const next = hasNext ?? (total != null ? page * pageSize < total : false);
  const control = (target: number, label: string, enabled: boolean) => {
    if (!enabled) return <span className="text-ink-3">{label}</span>;
    if (hrefForPage) return <Link href={hrefForPage(target)}>{label}</Link>;
    return (
      <button type="button" onClick={() => onPageChange?.(target)}>
        {label}
      </button>
    );
  };
  return (
    <nav aria-label={aria["aria-label"] ?? "Pagination"} className={cn("flex items-center justify-between text-body-md", className)}>
      <span className="text-ink-2">{total != null ? `${total === 0 ? 0 : from}-${to} of ${total}` : `Page ${page}`}</span>
      <span className="flex gap-4">
        {control(page - 1, "Previous", page > 1)}
        {control(page + 1, "Next", next)}
      </span>
    </nav>
  );
}
