// Reorderable rows for the event type editor (SPEC ET-17 locations, ET-24 questions "drag to reorder", GEN-05): a drag
// handle that works with the mouse (HTML5 drag and drop onto another row) and the keyboard (focus the handle, Arrow Up /
// Arrow Down move the row one step, Home / End to the ends), with a polite live announcement. Client only.
"use client";

import { GripVertical } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";

/** Returns a copy of `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export type SortableApi = {
  /** Props for the row element (drop target). */
  rowProps: (index: number) => {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    "data-drop-target"?: boolean;
    ref: (el: HTMLElement | null) => void;
  };
  /** Props for the handle button. */
  handleProps: (index: number, label: string) => React.ComponentProps<"button">;
  announcement: string;
  overIndex: number | null;
};

/**
 * Reorder state for a list of `count` rows; `onMove(from, to)` applies the move. Focus follows a keyboard move (the
 * handle of the moved row keeps focus).
 */
export function useSortable(count: number, onMove: (from: number, to: number) => void, opts: { disabled?: boolean; idPrefix: string }): SortableApi {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rows = useRef<(HTMLElement | null)[]>([]);
  const focusAfter = useRef<number | null>(null);

  useEffect(() => {
    if (focusAfter.current === null) return;
    const el = document.getElementById(`${opts.idPrefix}-handle-${focusAfter.current}`);
    el?.focus();
    focusAfter.current = null;
  });

  const move = useCallback(
    (from: number, to: number, label: string) => {
      const target = Math.max(0, Math.min(count - 1, to));
      if (target === from) return;
      onMove(from, target);
      focusAfter.current = target;
      setAnnouncement(`${label} moved to position ${target + 1} of ${count}.`);
    },
    [count, onMove],
  );

  return {
    announcement,
    overIndex,
    rowProps: (index) => ({
      ref: (el) => {
        rows.current[index] = el;
      },
      onDragOver: (e) => {
        if (dragFrom === null || opts.disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (overIndex !== index) setOverIndex(index);
      },
      onDragLeave: () => setOverIndex((v) => (v === index ? null : v)),
      onDrop: (e) => {
        if (dragFrom === null || opts.disabled) return;
        e.preventDefault();
        const from = dragFrom;
        setDragFrom(null);
        setOverIndex(null);
        if (from !== index) {
          onMove(from, index);
          setAnnouncement(`Moved to position ${index + 1} of ${count}.`);
        }
      },
      ...(overIndex === index && dragFrom !== null && dragFrom !== index ? { "data-drop-target": true } : {}),
    }),
    handleProps: (index, label) => ({
      id: `${opts.idPrefix}-handle-${index}`,
      type: "button",
      disabled: opts.disabled || count < 2,
      draggable: !opts.disabled && count > 1,
      "aria-label": `Reorder ${label}`,
      "aria-describedby": `${opts.idPrefix}-reorder-hint`,
      onDragStart: (e) => {
        setDragFrom(index);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
        const row = rows.current[index];
        if (row) e.dataTransfer.setDragImage(row, 16, 16);
      },
      onDragEnd: () => {
        setDragFrom(null);
        setOverIndex(null);
      },
      onKeyDown: (e) => {
        if (opts.disabled) return;
        if (e.key === "ArrowUp") {
          e.preventDefault();
          move(index, index - 1, label);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          move(index, index + 1, label);
        } else if (e.key === "Home") {
          e.preventDefault();
          move(index, 0, label);
        } else if (e.key === "End") {
          e.preventDefault();
          move(index, count - 1, label);
        }
      },
    }),
  };
}

/** The grip button of a sortable row. */
export function DragHandle(props: React.ComponentProps<"button">) {
  const { className, ...rest } = props;
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-primary-soft hover:text-primary-text active:cursor-grabbing disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
        className,
      )}
    >
      <GripVertical aria-hidden="true" className="size-4" />
    </button>
  );
}

/** The visually hidden instructions and live region of a sortable list. */
export function SortableAssist({ idPrefix, announcement }: { idPrefix: string; announcement: string }) {
  return (
    <>
      <span id={`${idPrefix}-reorder-hint`} className="sr-only">
        Press the up or down arrow keys to move this item. Drag with a mouse to reorder.
      </span>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
