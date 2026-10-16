// OWNER: foundation-ui.
//
// DataTable (ARCHITECTURE 20.2): sortable headers (aria-sort, buttons with direction icons), row selection with a
// tri-state "Select all", an empty state row, skeleton rows while loading the first page, keyboard-activatable rows
// (Enter) when onRowClick is set, and a pagination footer slot.
"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { Checkbox } from "./checkbox";
import { Skeleton } from "./skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "./table";

export type SortDirection = "asc" | "desc";
export type DataTableSort = { columnId: string; direction: SortDirection } | null;

export type DataTableColumn<T> = {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  width?: string;
  className?: string;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Accessible table name. */
  caption: string;
  sort?: DataTableSort;
  onSortChange?: (sort: DataTableSort) => void;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Rendered instead of the body when rows is empty. */
  empty?: React.ReactNode;
  loading?: boolean;
  /** Pagination or summary row under the table. */
  footer?: React.ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
  /** Accessible name of a row's checkbox (default "Select row"). */
  rowLabel?: (row: T) => string;
};

/** The next sort state when a sortable header is clicked: asc, then desc, then asc again. */
export function nextSort(current: DataTableSort, columnId: string): DataTableSort {
  if (current?.columnId === columnId) return { columnId, direction: current.direction === "asc" ? "desc" : "asc" };
  return { columnId, direction: "asc" };
}

const alignClass = (align?: "left" | "center" | "right") => (align === "right" ? "text-right" : align === "center" ? "text-center" : undefined);

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  sort,
  onSortChange,
  selectable,
  selectedIds = [],
  onSelectionChange,
  empty,
  loading,
  footer,
  onRowClick,
  className,
  rowLabel,
}: DataTableProps<T>) {
  const selected = new Set(selectedIds);
  const allIds = rows.map(getRowId);
  const selectedOnPage = allIds.filter((id) => selected.has(id)).length;
  const allState: boolean | "indeterminate" = allIds.length > 0 && selectedOnPage === allIds.length ? true : selectedOnPage > 0 ? "indeterminate" : false;
  const colCount = columns.length + (selectable ? 1 : 0);
  const showSkeleton = loading && rows.length === 0;
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)} aria-busy={loading || undefined}>
      <div className="min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
        <Table>
          <TableCaption>{caption}</TableCaption>
          <TableHeader className="bg-cloud">
            <TableRow>
              {selectable && (
                <TableHead className="w-10 pr-0">
                  <Checkbox
                    aria-label="Select all"
                    checked={allState}
                    disabled={allIds.length === 0}
                    onCheckedChange={(v) =>
                      onSelectionChange?.(v ? [...new Set([...selectedIds, ...allIds])] : selectedIds.filter((id) => !allIds.includes(id)))
                    }
                  />
                </TableHead>
              )}
              {columns.map((c) => {
                const active = sort?.columnId === c.id;
                const Icon = active ? (sort?.direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
                return (
                  <TableHead
                    key={c.id}
                    style={{ width: c.width }}
                    aria-sort={c.sortable ? (active ? (sort?.direction === "asc" ? "ascending" : "descending") : "none") : undefined}
                    className={alignClass(c.align)}
                  >
                    {c.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(nextSort(sort ?? null, c.id))}
                        className={cn("-mx-1 inline-flex items-center gap-1 rounded-[4px] px-1 py-0.5 hover:text-ink", active && "text-ink")}
                      >
                        {c.header}
                        <Icon aria-hidden="true" className={cn("size-3.5", !active && "opacity-60")} />
                      </button>
                    ) : (
                      c.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody className={cn(loading && rows.length > 0 && "opacity-60")}>
            {showSkeleton &&
              Array.from({ length: 5 }, (_, i) => (
                <TableRow key={`sk-${i}`}>
                  {Array.from({ length: colCount }, (_, j) => (
                    <TableCell key={j}>
                      <Skeleton height={14} width={j === 0 && selectable ? 18 : `${60 + ((i + j) % 3) * 15}%`} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!loading && rows.length === 0 && empty && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="p-0">
                  {empty}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => {
              const id = getRowId(row);
              const isSelected = selected.has(id);
              return (
                <TableRow
                  key={id}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row);
                        }
                      : undefined
                  }
                  className={cn(onRowClick && "cursor-pointer hover:bg-cloud focus-visible:outline-offset-[-2px]", isSelected && "bg-primary-soft hover:bg-primary-soft")}
                >
                  {selectable && (
                    <TableCell className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={rowLabel ? rowLabel(row) : "Select row"}
                        checked={isSelected}
                        onCheckedChange={(v) => onSelectionChange?.(v ? [...selectedIds, id] : selectedIds.filter((s) => s !== id))}
                      />
                    </TableCell>
                  )}
                  {columns.map((c) => (
                    <TableCell key={c.id} className={cn(alignClass(c.align), c.className)}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {footer}
    </div>
  );
}
