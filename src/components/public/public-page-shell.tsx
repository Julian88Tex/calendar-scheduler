// OWNER: foundation-ui.
//
// PublicPageShell (ARCHITECTURE 20.2, SPEC section 8, BK-03, BK-25, BK-26, BR-07, GEN-22): the #FAFAFA canvas of public
// pages in the classic tokens, light or dark by the visitor's device setting (data-public-auto; branding background or
// text colors and embeds stay light with data-force-light, whatever the dashboard theme), with branding
// colors as CSS variables (--primary-color for every blue, --public-bg for the card, --public-text for its text),
// the BK-03 spacing (66px top, 30px bottom, 5% sides; none on phones), embed mode (transparent canvas, no padding),
// the footer links and the cookie banner. Server and client safe: put it at the top of public pages.
import type * as React from "react";
import { cn } from "@/lib/cn";
import { CookieBanner } from "./cookie-banner";
import { DarkReaderLock } from "./dark-reader-lock";
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
  /** Privacy policy URL for the footer links (default /privacy). */
  privacyUrl?: string | null;
};

const HEX = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

/** "#rrggbb" for a valid 3 or 6 digit hex with or without "#" (embed params pass "ff0000"), else null (BK-26). */
export function normalizeBrandColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = HEX.exec(value.trim());
  if (!m) return null;
  const hex = m[1]!;
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  return `#${full.toLowerCase()}`;
}

export function brandingStyle(branding?: PublicBranding | null): React.CSSProperties {
  const style: Record<string, string> = {};
  const primary = normalizeBrandColor(branding?.primaryColor);
  const background = normalizeBrandColor(branding?.backgroundColor);
  const text = normalizeBrandColor(branding?.textColor);
  if (primary) style["--primary-color"] = primary;
  if (background) style["--public-bg"] = background;
  if (text) style["--public-text"] = text;
  return style as React.CSSProperties;
}

export function PublicPageShell({
  children,
  branding,
  embed,
  showFooterLinks = true,
  operatorEmail,
  pageUrl,
  trackersConfigured = false,
  hideGdprBanner,
  className,
  privacyUrl,
}: PublicPageShellProps) {
  const autoTheme = !embed && !normalizeBrandColor(branding?.backgroundColor) && !normalizeBrandColor(branding?.textColor);
  return (
    <div
      data-force-light={autoTheme ? undefined : ""}
      data-public-auto={autoTheme ? "" : undefined}
      data-public-shell=""
      style={brandingStyle(branding)}
      className={cn("min-h-dvh overflow-x-clip text-ink", embed ? "bg-transparent" : "bg-canvas", className)}
    >
      <main id="main" className={cn(embed ? "p-0" : "px-0 pt-0 pb-0 min-[600px]:px-[5%] min-[600px]:pt-[66px] min-[600px]:pb-[30px]")}>
        {children}
      </main>
      {showFooterLinks && !embed && (
        <PublicFooterLinks operatorEmail={operatorEmail} pageUrl={pageUrl} privacyUrl={privacyUrl} className="mx-auto max-w-[1060px] justify-center px-4 pt-2 pb-8" />
      )}
      {!hideGdprBanner && <CookieBanner trackersConfigured={trackersConfigured} />}
      {autoTheme && <DarkReaderLock />}
    </div>
  );
}
