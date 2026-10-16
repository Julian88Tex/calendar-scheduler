// Unsaved changes guard of the event type editor (SPEC ET-14): while the draft differs from the saved event type,
// closing or reloading the tab asks the browser's confirmation (beforeunload), and in-app link clicks are held back
// so the editor can show "You have unsaved changes" with "Discard changes" / "Keep editing". Client only.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type UnsavedGuard = {
  /** The href a held navigation was going to (dialog open while non-null). */
  pendingHref: string | null;
  /** Asks before navigating to `href` (in-app); navigates at once when clean. */
  request: (href: string) => void;
  /** Leaves to the pending href, discarding changes. */
  discard: () => void;
  /** Closes the dialog and stays. */
  keepEditing: () => void;
  /** Lets the next navigation through (after a save, or a deliberate redirect). */
  allowNext: () => void;
};

export function useUnsavedGuard(dirty: boolean, navigate: (href: string) => void): UnsavedGuard {
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const bypass = useRef(false);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || bypass.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    // Capture phase, so Next's <Link> click handler never starts the navigation while changes are unsaved.
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || bypass.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const request = useCallback(
    (href: string) => {
      if (dirtyRef.current && !bypass.current) setPendingHref(href);
      else navigate(href);
    },
    [navigate],
  );

  const discard = useCallback(() => {
    const href = pendingHref;
    setPendingHref(null);
    bypass.current = true;
    if (href) navigate(href);
  }, [pendingHref, navigate]);

  return {
    pendingHref,
    request,
    discard,
    keepEditing: () => setPendingHref(null),
    allowNext: () => {
      bypass.current = true;
    },
  };
}
