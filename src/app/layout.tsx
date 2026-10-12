// OWNER: foundation-ui.
//
// Root layout (ARCHITECTURE section 4 step 2 and 20.1): every route renders at request time (dynamic =
// "force-dynamic", nothing reads the database during `next build`, tech-reference 1.3), self-hosted Figtree, the
// global CSS tokens, a skip link, the Toaster and the document language. GEN-22: for /app pages the theme attribute
// comes from the preference cookie (kept in sync by the dashboard's ThemeController) and is set on <html> in the
// server response, so dark mode never flashes; public pages always render the light classic tokens.
import "@fontsource-variable/figtree";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type * as React from "react";
import { parseTheme, THEME_COOKIE, themeAttribute, themedPath } from "@/components/shell/theme";
import { Toaster } from "@/components/ui/toast";
import { PATHNAME_HEADER } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s - ${APP_NAME}` },
  applicationName: APP_NAME,
  description: `Scheduling made simple with ${APP_NAME}.`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const pathname = (h.get(PATHNAME_HEADER) ?? "").split("?")[0];
  const theme = themedPath(pathname) ? themeAttribute(parseTheme(jar.get(THEME_COOKIE)?.value)) : undefined;
  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
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
