// Drag and drop reorder of the event type cards (SPEC ET-07, GEN-04, GEN-05; walkthrough 5.1): a grip handle on each
// card.
// Pointer (mouse, touch or pen, through Pointer Events so it works the same in every browser and on touch screens):
// press the handle and move; the card follows the pointer, a blue line shows where it lands, the page scrolls near the
// top and bottom edges, releasing drops it and Escape cancels. A press that does not move is not a drag.
// Keyboard: focus the handle, Space (or Enter) lifts the card, the arrow keys move it (Home and End to the ends), Space
// drops it and Escape puts it back; moving focus away drops it where it is. Every step is announced in a polite live
// region. `onCommit(order)` receives the complete new order of ids once a card is dropped somewhere new. Client only.
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { dropOrder, moveId, pointerDropTarget, reorderAnnouncements as say, sameOrder, type RowBox } from "./reorder";

type Drop = { id: string; position: "before" | "after" };

/** Pointer travel (px) before a press on the handle becomes a drag (a click or tap never moves anything). */
const DRAG_THRESHOLD = 4;
/** Distance (px) from the top or bottom of the viewport where a drag scrolls the page. */
const SCROLL_EDGE = 56;
const SCROLL_STEP = 12;

export type ReorderApi = {
  /** The order to render (the lifted card's live position while moving it with the keyboard). */
  order: string[];
  liftedId: string | null;
  /** The card being dragged with a pointer. */
  draggingId: string | null;
  /** Where the dragged card would land (null when the drop would not change the order). */
  dropTarget: Drop | null;
  announcement: string;
  handleProps: (id: string, name: string) => React.ComponentProps<"button">;
  /** Ref callback of a card's row element (measured during a drag, moved with the pointer). */
  registerRow: (id: string) => (el: HTMLElement | null) => void;
};

type PointerDrag = { started: boolean; stop: () => void };

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
  const liftedName = useRef("");
  const startIndex = useRef(0);
  // A keyboard move re-inserts DOM nodes, which can blur the handle: those blurs must not drop the card.
  const moving = useRef(false);
  // The latest props for the window listeners of a pointer drag.
  const idsRef = useRef(ids);
  const enabledRef = useRef(enabled);
  const commitRef = useRef(onCommit);
  const drag = useRef<PointerDrag | null>(null);

  useLayoutEffect(() => {
    idsRef.current = ids;
    enabledRef.current = enabled;
    commitRef.current = onCommit;
  });

  useEffect(() => {
    const current = drag;
    return () => current.current?.stop();
  }, []);

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

  const finish = (commit: boolean) => {
    const lifted = liftedRef.current;
    if (!lifted) return;
    const name = liftedName.current;
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

  const rowBoxes = (): RowBox[] =>
    idsRef.current.flatMap((rowId) => {
      const el = rows.current.get(rowId);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ id: rowId, top: r.top, bottom: r.bottom }];
    });

  /** Starts tracking a press on the handle of `id`; it becomes a drag once the pointer travels DRAG_THRESHOLD px. */
  const startPointer = (e: React.PointerEvent<HTMLButtonElement>, id: string, name: string) => {
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const startScroll = window.scrollY;
    let lastY = startY;
    let target: Drop | null = null;
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // Not an active pointer (synthetic events): the window listeners below still follow it.
    }
    const userSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const row = () => rows.current.get(id);

    const update = (y: number) => {
      lastY = y;
      const el = row();
      if (el) el.style.transform = `translateY(${y - startY + window.scrollY - startScroll}px)`;
      const next = pointerDropTarget(idsRef.current, rowBoxes(), y, id);
      target = next;
      setDropTarget((cur) => (cur?.id === next?.id && cur?.position === next?.position ? cur : next));
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!state.started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        state.started = true;
        setDraggingId(id);
        const el = row();
        if (el) el.style.zIndex = "20";
      }
      ev.preventDefault();
      update(ev.clientY);
      if (ev.clientY < SCROLL_EDGE) window.scrollBy(0, -SCROLL_STEP);
      else if (ev.clientY > window.innerHeight - SCROLL_EDGE) window.scrollBy(0, SCROLL_STEP);
    };
    const onScroll = () => {
      if (state.started) update(lastY);
    };
    const end = (commit: boolean) => {
      const started = state.started;
      state.stop();
      if (!started) return;
      setDraggingId(null);
      setDropTarget(null);
      const current = idsRef.current;
      const landing = commit && enabledRef.current ? target : null;
      const next = landing ? dropOrder(current, id, landing.id, landing.position) : current;
      if (sameOrder(next, current)) {
        if (!commit) setAnnouncement(say.canceled(name, current.indexOf(id) + 1));
        return;
      }
      setAnnouncement(say.dropped(name, next.indexOf(id) + 1, next.length));
      commitRef.current(next);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) end(true);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) end(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      end(false);
    };

    const state: PointerDrag = {
      started: false,
      stop: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("scroll", onScroll);
        document.body.style.userSelect = userSelect;
        const el = row();
        if (el) {
          el.style.transform = "";
          el.style.zIndex = "";
        }
        try {
          if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        } catch {
          // Already released.
        }
        if (drag.current === state) drag.current = null;
      },
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    drag.current = state;
  };

  const handleProps = (id: string, name: string): React.ComponentProps<"button"> => ({
    id: handleId(id),
    type: "button",
    "aria-label": `Reorder ${name}`,
    "aria-describedby": `${idPrefix}-reorder-hint`,
    "aria-pressed": liftedId === id,
    disabled: !enabled,
    onPointerDown: (e) => {
      if (!enabled || e.button !== 0 || !e.isPrimary || liftedRef.current || drag.current) return;
      startPointer(e, id, name);
    },
    onKeyDown: (e) => {
      if (!enabled || drag.current) return;
      const lifted = liftedRef.current === id;
      const current = draftRef.current ?? ids;
      const count = current.length;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (lifted) {
          finish(true);
        } else {
          // Another card is still lifted: drop it first (lifting this one needs the refreshed order).
          if (liftedRef.current) {
            finish(true);
            return;
          }
          startIndex.current = ids.indexOf(id);
          liftedName.current = name;
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
        finish(false);
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
        if (liftedRef.current === id && !moving.current && document.activeElement !== handle) finish(true);
      });
    },
  });

  const registerRow: ReorderApi["registerRow"] = (id) => (el) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  };

  return { order, liftedId, draggingId, dropTarget, announcement, handleProps, registerRow };
}
