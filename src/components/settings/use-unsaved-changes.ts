// Unsaved changes guard of the settings forms (Profile, My Link). While a form is dirty:
// - reloading, closing the tab or following a link to another site shows the browser's own "Leave site?" prompt
//   (beforeunload);
// - clicking a link inside the app (sidebar, settings sub-navigation, account menu) asks first with UNSAVED_MESSAGE
//   and stays on the page when the user cancels. Client-side navigations never fire beforeunload, so the click is
//   intercepted in the capture phase, before Next's Link handles it.
// Browser only (used by client components); leavesPageInApp is pure.
import { useEffect, useRef } from "react";

export const UNSAVED_MESSAGE = "You have unsaved changes. Leave this page without saving them?";

type ClickLike = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };
type AnchorLike = { href: string; target: string; hasAttribute(name: string): boolean };

/**
 * True when this click on this link would replace the current page in the same tab with another page of the app
 * (same origin, different path or query). Modified and middle clicks, new-tab targets, downloads and in-page anchors
 * do not leave; links to other sites leave through a full navigation, which beforeunload already covers.
 */
export function leavesPageInApp(click: ClickLike, anchor: AnchorLike, current: { href: string }): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if (anchor.hasAttribute("download")) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  let to: URL;
  let from: URL;
  try {
    from = new URL(current.href);
    to = new URL(anchor.href, from);
  } catch {
    return false;
  }
  if (to.origin !== from.origin) return false;
  return to.pathname !== from.pathname || to.search !== from.search;
}

/** Asks before leaving while `dirty` (see the file header). */
export function useUnsavedChangesGuard(dirty: boolean, message: string = UNSAVED_MESSAGE): void {
  const confirmed = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    confirmed.current = false;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (confirmed.current) return;
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || !leavesPageInApp(e, anchor, window.location)) return;
      if (window.confirm(message)) {
        // A plain <a> also unloads the page: do not ask a second time.
        confirmed.current = true;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, message]);
}
