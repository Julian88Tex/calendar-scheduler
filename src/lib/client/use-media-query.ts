// useMediaQuery (ARCHITECTURE section 20.2): true while the CSS media query matches (false during SSR and the first
// client render, so markup hydrates consistently). Client components only.
import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** GEN-04 breakpoints. */
export const MEDIA = {
  phone: "(max-width: 599px)",
  tablet: "(min-width: 600px) and (max-width: 999px)",
  desktop: "(min-width: 1000px)",
  dashboardDrawer: "(max-width: 767px)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  dark: "(prefers-color-scheme: dark)",
} as const;
