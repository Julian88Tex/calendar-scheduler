// OWNER: foundation-ui.
//
// While the visitor's device is in dark mode, public pages render their own dark theme (globals.css,
// [data-public-auto]); this adds <meta name="darkreader-lock"> so the Dark Reader extension leaves that theme alone
// instead of darkening it a second time. In light mode the meta is removed and extensions behave as before.
"use client";

import { useEffect } from "react";

export function DarkReaderLock() {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    let meta: HTMLMetaElement | null = null;
    const apply = () => {
      if (query.matches && !meta) {
        meta = document.createElement("meta");
        meta.name = "darkreader-lock";
        document.head.appendChild(meta);
      } else if (!query.matches && meta) {
        meta.remove();
        meta = null;
      }
    };
    apply();
    query.addEventListener("change", apply);
    return () => {
      query.removeEventListener("change", apply);
      meta?.remove();
    };
  }, []);
  return null;
}
