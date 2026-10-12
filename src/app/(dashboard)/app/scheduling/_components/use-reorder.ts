// Drag and drop reorder of the event type cards (SPEC ET-07, GEN-05; walkthrough 5.1): a grip handle on each card.
// Mouse: drag the handle and drop the card before or after another card (a blue line shows where it lands).
// Keyboard: focus the handle, Space (or Enter) lifts the card, the arrow keys move it (Home and End to the ends), Space
// drops it and Escape puts it back; moving focus away drops it where it is. Every step is announced in a polite live
// region. `onCommit(order)` receives the complete new order of ids once a card is dropped somewhere new. Client only.
"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { dropOrder, moveId, reorderAnnouncements as say, sameOrder } from "./reorder";

type Drop = { id: string; position: "before" | "after" };

export type ReorderApi = {
  /** The order to render (the lifted card's live position while moving it with the keyboard). */
  order: string[];
  liftedId: string | null;
  draggingId: string | null;
  /** Where the dragged card would land (null when not over another card). */
  dropTarget: Drop | null;
  announcement: string;
  handleProps: (id: string, name: string) => React.ComponentProps<"button">;
  rowProps: (id: string) => Pick<React.ComponentProps<"li">, "onDragOver" | "onDrop"> & { ref: (el: HTMLElement | null) => void };
  listProps: Pick<React.ComponentProps<"ul">, "onDragOver" | "onDragLeave" | "onDrop">;
};

export function useReorder(opts: { ids: string[]; enabled: boolean; idPrefix: string; onCommit: (order: string[]) => void }): ReorderApi {
  const { ids, enabled, idPrefix, onCommit } = opts;
  const [draft, setDraftState] = useState<string[] | null>(null);
  const [liftedId, setLiftedState] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<Drop | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rows = useRef(new Map<string, HTMLElement>());
  // Refs mirror the keyboard state so key, blur and frame callbacks never act on a stale render.
  const draftRef = useRef<string[] | null>(null);
  const liftedRef = useRef<string | null>(null);
  const startIndex = useRef(0);
  // A keyboard move re-inserts DOM nodes, which can blur the handle: those blurs must not drop the card.
  const moving = useRef(false);

  const order = draft ?? ids;
  const handleId = (id: string) => `${idPrefix}-handle-${id}`;

  const setDraft = (next: string[] | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const setLifted = (next: string | null) => {
    liftedRef.current = next;
    setLiftedState(next);
  };

  useLayoutEffect(() => {
    if (!moving.current) return;
    moving.current = false;
    if (liftedId) document.getElementById(handleId(liftedId))?.focus();
  });

  const finish = (commit: boolean, name: string) => {
    const lifted = liftedRef.current;
    if (!lifted) return;
    const current = draftRef.current ?? ids;
    setDraft(null);
    setLifted(null);
    if (!commit) {
      setAnnouncement(say.canceled(name, startIndex.current + 1));
      return;
    }
    setAnnouncement(say.dropped(name, current.indexOf(lifted) + 1, current.length));
    if (!sameOrder(current, ids)) onCommit(current);
  };

  const handleProps = (id: string, name: string): React.ComponentProps<"button"> => ({
    id: handleId(id),
    type: "button",
    "aria-label": `Reorder ${name}`,
    "aria-describedby": `${idPrefix}-reorder-hint`,
    "aria-pressed": liftedId === id,
    disabled: !enabled,
    draggable: enabled,
    onKeyDown: (e) => {
      if (!enabled) return;
      const lifted = liftedRef.current === id;
      const current = draftRef.current ?? ids;
      const count = current.length;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (lifted) {
          finish(true, name);
        } else {
          if (liftedRef.current) finish(true, name);
          startIndex.current = ids.indexOf(id);
          setDraft([...ids]);
          setLifted(id);
          setAnnouncement(say.lifted(name, startIndex.current + 1, count));
        }
        return;
      }
      if (!lifted) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false, name);
        return;
      }
      const at = current.indexOf(id);
      let to: number | null = null;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") to = at - 1;
      else if (e.key === "ArrowDown" || e.key === "ArrowRight") to = at + 1;
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = count - 1;
      if (to === null) return;
      e.preventDefault();
      const target = Math.max(0, Math.min(count - 1, to));
      if (target === at) return;
      moving.current = true;
      setDraft(moveId(current, id, target));
      setAnnouncement(say.moved(name, target + 1, count));
    },
    onBlur: (e) => {
      if (liftedRef.current !== id || moving.current) return;
      const handle = e.currentTarget;
      // Wait for the re-render: a move that blurred the handle focuses it again in the layout effect.
      requestAnimationFrame(() => {
        if (liftedRef.current === id && !moving.current && document.activeElement !== handle) finish(true, name);
      });
    },
    onDragStart: (e) => {
      if (!enabled) {
        e.preventDefault();
        return;
      }
      setDraggingId(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      const row = rows.current.get(id);
      if (row) e.dataTransfer.setDragImage(row, 24, 24);
    },
    onDragEnd: () => {
      setDraggingId(null);
      setDropTarget(null);
    },
  });

  const dropAt = (target: Drop | null) => {
    const dragged = draggingId;
    setDraggingId(null);
    setDropTarget(null);
    if (!dragged || !target) return;
    const next = dropOrder(ids, dragged, target.id, target.position);
    if (sameOrder(next, ids)) return;
    setAnnouncement(`Moved to position ${next.indexOf(dragged) + 1} of ${next.length}.`);
    onCommit(next);
  };

  const rowProps: ReorderApi["rowProps"] = (id) => ({
    ref: (el) => {
      if (el) rows.current.set(id, el);
      else rows.current.delete(id);
    },
    onDragOver: (e) => {
      if (!draggingId || !enabled) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      const next: Drop | null = id === draggingId ? null : { id, position };
      if (next?.id !== dropTarget?.id || next?.position !== dropTarget?.position) setDropTarget(next);
    },
    onDrop: (e) => {
      if (!draggingId) return;
      e.preventDefault();
      e.stopPropagation();
      dropAt(dropTarget);
    },
  });

  const listProps: ReorderApi["listProps"] = {
    // The gaps between cards keep the last drop target so a drop there still lands; leaving the list clears it.
    onDragOver: (e) => {
      if (draggingId && enabled) e.preventDefault();
    },
    onDragLeave: (e) => {
      if (draggingId && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (e) => {
      if (!draggingId) return;
      e.preventDefault();
      dropAt(dropTarget);
    },
  };

  return { order, liftedId, draggingId, dropTarget, announcement, handleProps, rowProps, listProps };
}
