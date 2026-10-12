// OWNER: foundation-ui.
//
// Shared open state of the mobile navigation drawer (SPEC GEN-04, GEN-20): AppHeader's hamburger opens it, AppSidebar
// renders the drawer. A tiny module store (both components are siblings in the dashboard layout). Client only.
"use client";

import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setMobileNavOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}

export function useMobileNavOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => false,
  );
}
