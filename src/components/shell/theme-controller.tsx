// OWNER: foundation-ui.
//
// ThemeController (SPEC GEN-22): rendered by the dashboard layout with users.preferences.theme. Applies the theme to
// <html> (the root layout already set it before paint from the cookie) and keeps the cookie in sync; removes it when
// the user navigates from the dashboard to a public page (public pages stay in the light classic theme).
"use client";

import { useEffect } from "react";
import { applyTheme, clearThemeAttribute, type ThemePreference } from "./theme";

export function ThemeController({ theme }: { theme: ThemePreference }) {
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => () => clearThemeAttribute(), []);
  return null;
}
