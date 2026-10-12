// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Root layout (ARCHITECTURE section 4 step 2): every route renders at request time (dynamic = "force-dynamic", nothing
// reads the database during `next build`, tech-reference 1.3), self-hosted Figtree, the global CSS tokens, the
// Toaster and the document language. The data-theme script for GEN-22 belongs to foundation-ui.
import "@fontsource-variable/figtree";
import "./globals.css";
import type { Metadata } from "next";
import type * as React from "react";
import { Toaster } from "@/components/ui/toast";
import { APP_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s - ${APP_NAME}` },
  applicationName: APP_NAME,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
