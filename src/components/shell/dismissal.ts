// OWNER: foundation-ui.
//
// Session-scoped dismissal of dashboard banners (dismissed banners come back in the next browser session, so the
// underlying problem is not forgotten). Client only; blocked storage keeps them dismissed for the page view.
"use client";

import { useState, useSyncExternalStore } from "react";

const PREFIX = "kairos:banner-dismissed:";
const noop = () => () => {};

function read(key: string): boolean {
  try {
    return window.sessionStorage.getItem(PREFIX + key) === "1";
  } catch {
    return false;
  }
}

/** [dismissed, dismiss] for a banner key (false during server rendering and hydration). */
export function useSessionDismissal(key: string): [boolean, () => void] {
  const stored = useSyncExternalStore(noop, () => read(key), () => false);
  const [local, setLocal] = useState(false);
  const dismiss = () => {
    setLocal(true);
    try {
      window.sessionStorage.setItem(PREFIX + key, "1");
    } catch {
      // storage blocked: dismissed for this page view
    }
  };
  return [stored || local, dismiss];
}
