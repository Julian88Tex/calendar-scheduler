// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// PublicPageShell (ARCHITECTURE 20.2, SPEC section 8, BK-25, BK-26, BR-07): the #FAFAFA canvas of public pages with
// branding colors as CSS variables (--primary-color, --public-bg, --public-text), embed mode (no canvas padding, no
// banner), the footer links and the cookie banner. Server and client safe: put it at the top of public pages.
import type * as React from "react";
import { cn } from "@/lib/cn";
import { CookieBanner } from "./cookie-banner";
import { PublicFooterLinks } from "./public-footer-links";

export type PublicBranding = {
  /** Hex colors (BR-07; empty means the classic tokens). */
  primaryColor?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
};

export type PublicPageShellProps = {
  children: React.ReactNode;
  branding?: PublicBranding | null;
  /** Embed mode (embed_type present): transparent canvas, no outer padding. */
  embed?: boolean;
  /** Render the footer links under the content (default true; booking pages place them in the card instead). */
  showFooterLinks?: boolean;
  operatorEmail?: string | null;
  pageUrl?: string;
  /** Cookie banner: rendered only when trackers are configured and hideGdprBanner is false. */
  trackersConfigured?: boolean;
  hideGdprBanner?: boolean;
  className?: string;
};

export function brandingStyle(branding?: PublicBranding | null): React.CSSProperties {
  const style: Record<string, string> = {};
  if (branding?.primaryColor) style["--primary-color"] = branding.primaryColor;
  if (branding?.backgroundColor) style["--public-bg"] = branding.backgroundColor;
  if (branding?.textColor) style["--public-text"] = branding.textColor;
  return style as React.CSSProperties;
}

export function PublicPageShell({ children, branding, embed, showFooterLinks = true, operatorEmail, pageUrl, trackersConfigured = false, hideGdprBanner, className }: PublicPageShellProps) {
  return (
    <div style={brandingStyle(branding)} className={cn("min-h-screen", embed ? "bg-transparent" : "bg-canvas px-4 py-8 md:py-16", className)}>
      <main id="main">{children}</main>
      {showFooterLinks && !embed && <PublicFooterLinks operatorEmail={operatorEmail} pageUrl={pageUrl} className="mx-auto mt-6 max-w-[1060px] justify-center" />}
      {!hideGdprBanner && <CookieBanner trackersConfigured={trackersConfigured} />}
    </div>
  );
}
