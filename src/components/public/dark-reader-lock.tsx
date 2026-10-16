// OWNER: foundation-ui.
//
// While public pages render their own dark theme (the visitor's choice from PublicThemeToggle, else the device
// setting; globals.css, [data-public-auto]) this adds <meta name="darkreader-lock"> so the Dark Reader extension leaves
// that theme alone instead of darkening it a second time. In light mode the meta is removed and extensions behave as
// before.
"use client";

import { useEffect } from "react";
import { publicThemeIsDark } from "@/components/shell/theme";

export function DarkReaderLock() {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    let meta: HTMLMetaElement | null = null;
    const apply = () => {
      const dark = publicThemeIsDark();
      if (dark && !meta) {
        meta = document.createElement("meta");
        meta.name = "darkreader-lock";
        document.head.appendChild(meta);
      } else if (!dark && meta) {
        meta.remove();
        meta = null;
      }
    };
    apply();
    query.addEventListener("change", apply);
    // The theme toggle changes <html data-public-theme>.
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-public-theme"] });
    return () => {
      query.removeEventListener("change", apply);
      observer.disconnect();
      meta?.remove();
    };
  }, []);
  return null;
}
