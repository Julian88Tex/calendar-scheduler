// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// DataTable (ARCHITECTURE 20.2): sortable headers, row selection, empty state, loading and a pagination footer.
"use client";

import type * as React from "react";
import { cn } from "@/lib/cn";
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
};

export function DataTable<T>({ columns, rows, getRowId, caption, sort, onSortChange, selectable, selectedIds = [], onSelectionChange, empty, loading, footer, onRowClick, className }: DataTableProps<T>) {
  const selected = new Set(selectedIds);
  const allIds = rows.map(getRowId);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-busy={loading || undefined}>
      <Table>
        <TableCaption>{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-8">
                <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={(e) => onSelectionChange?.(e.target.checked ? allIds : [])} />
              </TableHead>
            )}
            {columns.map((c) => {
              const active = sort?.columnId === c.id;
              return (
                <TableHead key={c.id} style={{ width: c.width }} aria-sort={active ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined} className={cn(c.align === "right" && "text-right", c.align === "center" && "text-center")}>
                  {c.sortable && onSortChange ? (
                    <button type="button" onClick={() => onSortChange({ columnId: c.id, direction: active && sort?.direction === "asc" ? "desc" : "asc" })}>
                      {c.header}
                      {active ? (sort?.direction === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const id = getRowId(row);
            return (
              <TableRow key={id} onClick={onRowClick ? () => onRowClick(row) : undefined} className={onRowClick ? "cursor-pointer hover:bg-cloud" : undefined}>
                {selectable && (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label="Select row"
                      checked={selected.has(id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onSelectionChange?.(e.target.checked ? [...selectedIds, id] : selectedIds.filter((s) => s !== id))}
                    />
                  </TableCell>
                )}
                {columns.map((c) => (
                  <TableCell key={c.id} className={cn(c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {rows.length === 0 && !loading && empty}
      {footer}
    </div>
  );
}
