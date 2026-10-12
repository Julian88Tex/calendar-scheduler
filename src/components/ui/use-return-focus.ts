// OWNER: foundation-ui.
//
// useReturnFocus (SPEC GEN-05): Radix dialogs return focus to their own Trigger only. Dialogs opened from controlled
// state (a menu item, a button elsewhere, the shell drawer) would drop focus to <body> on close. Spread the returned
// handlers on the Radix Content: on open it remembers the element that had focus, on close it focuses that element
// again when it is still in the document (otherwise Radix's default applies).
"use client";

import { useRef } from "react";

export type ReturnFocusHandlers = {
  onOpenAutoFocus: (event: Event) => void;
  onCloseAutoFocus: (event: Event) => void;
};

export function useReturnFocus(enabled = true): ReturnFocusHandlers {
  const previous = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      if (!enabled) return;
      const el = document.activeElement;
      previous.current = el instanceof HTMLElement && el !== document.body ? el : null;
    },
    onCloseAutoFocus: (event) => {
      const el = previous.current;
      previous.current = null;
      if (!enabled || !el || !el.isConnected) return;
      event.preventDefault();
      el.focus({ preventScroll: true });
    },
  };
}
