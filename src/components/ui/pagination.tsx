// OWNER: foundation-ui.
//
// Pagination (ARCHITECTURE 20.2): "Previous / Next" pill buttons with a "1-25 of 120" summary (or "Page n" for keyset
// lists without a total). Works with page links (hrefForPage, server rendered lists) or callbacks (onPageChange).
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { buttonClassName } from "./button";

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

export function paginationSummary(page: number, pageSize: number, total?: number | null): string {
  if (total == null) return `Page ${page}`;
  if (total === 0) return "0 of 0";
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return `${from}-${to} of ${total}`;
}

export function Pagination({ page, pageSize, total, hasNext, onPageChange, hrefForPage, className, ...aria }: PaginationProps) {
  const next = hasNext ?? (total != null ? page * pageSize < total : false);
  const cls = buttonClassName({ variant: "secondary", size: "sm" });
  const control = (target: number, label: string, enabled: boolean, dir: "prev" | "next") => {
    const content = (
      <>
        {dir === "prev" && <ChevronLeft aria-hidden="true" />}
        {label}
        {dir === "next" && <ChevronRight aria-hidden="true" />}
      </>
    );
    if (!enabled) {
      return (
        <span aria-disabled="true" className={cls}>
          {content}
        </span>
      );
    }
    if (hrefForPage) {
      return (
        <Link href={hrefForPage(target)} className={cls} rel={dir}>
          {content}
        </Link>
      );
    }
    return (
      <button type="button" className={cls} onClick={() => onPageChange?.(target)}>
        {content}
      </button>
    );
  };
  return (
    <nav aria-label={aria["aria-label"] ?? "Pagination"} className={cn("flex flex-wrap items-center justify-between gap-3 text-[14px]", className)}>
      <span className="text-ink-2" aria-live="polite">
        {paginationSummary(page, pageSize, total)}
      </span>
      <span className="flex gap-2">
        {control(page - 1, "Previous", page > 1, "prev")}
        {control(page + 1, "Next", next, "next")}
      </span>
    </nav>
  );
}
