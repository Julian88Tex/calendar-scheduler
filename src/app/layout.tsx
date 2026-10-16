// OWNER: foundation-ui.
//
// Root layout (ARCHITECTURE section 4 step 2 and 20.1): every route renders at request time (dynamic =
// "force-dynamic", nothing reads the database during `next build`, tech-reference 1.3), self-hosted Figtree, the
// global CSS tokens, a skip link, the Toaster and the document language. GEN-22: for /app pages the theme attribute
// comes from the preference cookie (kept in sync by the dashboard's ThemeController) and is set on <html> in the
// server response, so dark mode never flashes; public pages follow the device setting unless the visitor picked light or
// dark with the public theme toggle (data-public-theme from its cookie).
import "@fontsource-variable/figtree";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type * as React from "react";
import { parsePublicTheme, parseTheme, PUBLIC_THEME_COOKIE, THEME_COOKIE, themeAttribute, themedPath } from "@/components/shell/theme";
import { Toaster } from "@/components/ui/toast";
import { PATHNAME_HEADER } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/brand";
import { GOOGLE_SITE_VERIFICATION } from "@/lib/site-verification";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s - ${APP_NAME}` },
  applicationName: APP_NAME,
  description: `Scheduling made simple with ${APP_NAME}.`,
  ...(GOOGLE_SITE_VERIFICATION ? { verification: { google: GOOGLE_SITE_VERIFICATION } } : {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const pathname = (h.get(PATHNAME_HEADER) ?? "").split("?")[0];
  const dashboard = themedPath(pathname);
  const theme = dashboard ? themeAttribute(parseTheme(jar.get(THEME_COOKIE)?.value)) : undefined;
  // Public pages: the visitor's light/dark choice (PublicThemeToggle) is set before paint, so it never flashes.
  const publicTheme = dashboard ? undefined : parsePublicTheme(jar.get(PUBLIC_THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme} data-public-theme={publicTheme} suppressHydrationWarning>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <a
          href="#main"
          className="sr-only z-[100] rounded-full bg-primary px-4 py-2 text-[14px] font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to main content
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
