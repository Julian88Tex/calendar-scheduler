// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// PublicFooterLinks (ARCHITECTURE 20.2, SPEC GEN-14, GEN-21): "Cookie settings", "Privacy Policy" and "Report abuse"
// (mailto the instance operator with subject "Report abuse: {page URL}").
"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { CookieSettingsDialog } from "./cookie-settings-dialog";
import { reportAbuseHref } from "./report-abuse";

export type PublicFooterLinksProps = {
  /** Instance operator email (MK-02); the Report abuse link is hidden without one. */
  operatorEmail?: string | null;
  /** The current page URL for the abuse report subject (default: window.location.href at click time). */
  pageUrl?: string;
  /** Show the Cookie settings link (default true). */
  showCookieSettings?: boolean;
  className?: string;
};

export function PublicFooterLinks({ operatorEmail, pageUrl, showCookieSettings = true, className }: PublicFooterLinksProps) {
  const [open, setOpen] = useState(false);
  return (
    <nav aria-label="Footer" className={cn("flex flex-wrap gap-4 text-body-sm text-primary-text", className)}>
      {showCookieSettings && (
        <button type="button" onClick={() => setOpen(true)}>
          Cookie settings
        </button>
      )}
      <Link href="/privacy">Privacy Policy</Link>
      {operatorEmail && (
        <a
          href={reportAbuseHref(operatorEmail, pageUrl ?? "")}
          onClick={(e) => {
            if (!pageUrl) e.currentTarget.href = reportAbuseHref(operatorEmail, window.location.href);
          }}
        >
          Report abuse
        </a>
      )}
      {showCookieSettings && <CookieSettingsDialog open={open} onOpenChange={setOpen} />}
    </nav>
  );
}
