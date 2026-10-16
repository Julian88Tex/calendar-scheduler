// OWNER: foundation-ui.
//
// GEN-22 appearance plumbing shared by the root layout (server: reads the cookie and sets data-theme on <html> before
// paint for /app pages), the dashboard ThemeController (client: applies users.preferences.theme and mirrors it in the
// cookie) and Settings > Profile (call applyTheme(theme) after saving for an immediate switch). Client and server safe.

export type ThemePreference = "light" | "dark" | "system";

/** First-party preference cookie (essential: UI preference, no tracking). */
export const THEME_COOKIE = "kairos_theme";

export function parseTheme(value: unknown): ThemePreference {
  return value === "dark" || value === "system" ? value : "light";
}

/** Paths that use the dashboard theme (public pages always render the light classic tokens). */
export function themedPath(pathname: string | null | undefined): boolean {
  return Boolean(pathname && (pathname === "/app" || pathname.startsWith("/app/") || pathname.startsWith("/onboarding")));
}

/** The <html data-theme> value for a preference (light means no attribute). */
export function themeAttribute(theme: ThemePreference): "dark" | "system" | undefined {
  return theme === "light" ? undefined : theme;
}

/** Client: applies a preference to <html> and remembers it in the cookie (one year). */
export function applyTheme(theme: ThemePreference): void {
  if (typeof document === "undefined") return;
  const attr = themeAttribute(theme);
  if (attr) document.documentElement.setAttribute("data-theme", attr);
  else document.documentElement.removeAttribute("data-theme");
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax${secure}`;
}

/** Client: removes the dashboard theme (leaving the dashboard for a public page). */
export function clearThemeAttribute(): void {
  if (typeof document === "undefined") return;
  document.documentElement.removeAttribute("data-theme");
}

/** Public pages: the visitor's own light/dark choice from PublicThemeToggle (absent = follow the device setting). */
export const PUBLIC_THEME_COOKIE = "kairos_public_theme";
export type PublicThemeChoice = "light" | "dark";

export function parsePublicTheme(value: unknown): PublicThemeChoice | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

/** Client: applies a public page choice to <html data-public-theme> and remembers it in the cookie (one year). */
export function applyPublicTheme(choice: PublicThemeChoice): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-public-theme", choice);
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${PUBLIC_THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax${secure}`;
}

/** Client: true when public pages currently render dark (the visitor's choice, else the device setting). */
export function publicThemeIsDark(): boolean {
  if (typeof document === "undefined") return false;
  const choice = parsePublicTheme(document.documentElement.getAttribute("data-public-theme"));
  if (choice) return choice === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
