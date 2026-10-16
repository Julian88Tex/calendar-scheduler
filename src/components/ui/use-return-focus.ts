// OWNER: foundation-ui.
//
// useReturnFocus (SPEC GEN-05): Radix dialogs return focus to their own Trigger only. Dialogs opened from controlled
// state (a menu item, a button elsewhere, the shell drawer) would drop focus to <body> on close. Spread the returned
// handlers on the Radix Content: on open it remembers the element that had focus, on close it focuses that element
// again when it is still in the document, else the `fallback` element, otherwise Radix's default applies.
// A dialog opened from a DropdownMenuItem mounts after the menu is gone (focus is on <body> then): DropdownMenuItem
// calls rememberReturnTarget() with the menu's trigger on select, so such dialogs return focus to that trigger.
"use client";

import { useRef } from "react";
import type * as React from "react";

export type ReturnFocusHandlers = {
  onOpenAutoFocus: (event: Event) => void;
  onCloseAutoFocus: (event: Event) => void;
};

/** How long a remembered menu trigger stays the return target for a dialog that opens next. */
const RETURN_TARGET_TTL_MS = 1500;
let pendingTarget: { el: HTMLElement; at: number } | null = null;

/** Records the element a dialog opening right now should return focus to (the trigger of the menu being closed). */
export function rememberReturnTarget(el: HTMLElement | null): void {
  pendingTarget = el ? { el, at: Date.now() } : null;
}

/** The menu trigger for an element inside a Radix menu (the menu content is labelled by its trigger). */
export function menuTriggerOf(el: Element | null): HTMLElement | null {
  const menu = el?.closest('[role="menu"]');
  const id = menu?.getAttribute("aria-labelledby");
  const trigger = id ? document.getElementById(id) : null;
  return trigger instanceof HTMLElement ? trigger : null;
}

function takePendingTarget(): HTMLElement | null {
  const t = pendingTarget;
  pendingTarget = null;
  return t && Date.now() - t.at <= RETURN_TARGET_TTL_MS && t.el.isConnected ? t.el : null;
}

export function useReturnFocus(enabled = true, fallback?: React.RefObject<HTMLElement | null>): ReturnFocusHandlers {
  const previous = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      if (!enabled) return;
      const el = document.activeElement;
      const pending = takePendingTarget();
      previous.current = el instanceof HTMLElement && el !== document.body ? el : pending;
    },
    onCloseAutoFocus: (event) => {
      const remembered = previous.current;
      previous.current = null;
      if (!enabled) return;
      const el = remembered?.isConnected ? remembered : fallback?.current?.isConnected ? fallback.current : null;
      if (!el) return;
      event.preventDefault();
      el.focus({ preventScroll: true });
    },
  };
}
