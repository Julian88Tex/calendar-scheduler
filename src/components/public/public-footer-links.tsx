// OWNER: foundation-ui.
//
// PublicFooterLinks (ARCHITECTURE 20.2, SPEC GEN-14, GEN-21, BK-01, BK-03): "Cookie settings" (opens the dialog; also
// opened by the OPEN_COOKIE_SETTINGS_EVENT window event), "Privacy Policy" (the host's URL or /privacy) and "Report
// abuse" (mailto the instance operator with subject "Report abuse: {page URL}"). Links are 13.5px semibold, read
// --primary-color and sit 34px apart (Calendly's footer, docs/research/calendly-live-capture.md item 6); from 600px up
// the "Cookie settings" button is drawn 1px above the links, as Calendly's is. The booking and landing pages pass no
// operator email: like Calendly they show only "Cookie settings" and "Privacy Policy".
"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { OPEN_COOKIE_SETTINGS_EVENT } from "./cookie-consent";
import { CookieSettingsDialog } from "./cookie-settings-dialog";
import { reportAbuseHref } from "./report-abuse";

export type PublicFooterLinksProps = {
  /** Instance operator email (MK-02); the Report abuse link is hidden without one. */
  operatorEmail?: string | null;
  /** The current page URL for the abuse report subject (default: window.location.href). */
  pageUrl?: string;
  /** Show the Cookie settings link (default true). */
  showCookieSettings?: boolean;
  className?: string;
  /** Show "Privacy Policy" (default true; the landing page shows only Cookie settings and Report abuse). */
  showPrivacyPolicy?: boolean;
  /** Host-configured privacy policy URL (default /privacy). */
  privacyUrl?: string | null;
  /**
   * Open this instance's dialog on the OPEN_COOKIE_SETTINGS_EVENT window event (default true). A page that renders a
   * second copy of the links (the booking card's phone footer) turns it off there so one event opens one dialog.
   */
  listenForOpenEvent?: boolean;
};

const noopSubscribe = () => () => {};

/**
 * A legal link target: a configured http(s) URL or a same-site path ("/privacy"); anything else (javascript:, data:,
 * protocol-relative "//host", an invalid URL) falls back to `fallback`.
 */
export function legalLinkHref(url: string | null | undefined, fallback: string): string {
  const t = (url ?? "").trim();
  if (/^\/(?![/\\])/.test(t)) return t;
  if (/^https?:\/\/[^\s]+$/i.test(t)) {
    try {
      const parsed = new URL(t);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
    } catch {
      // invalid URL: fall back below
    }
  }
  return fallback;
}

/** The privacy policy link target: the configured URL when safe, else /privacy. */
export function privacyPolicyHref(url: string | null | undefined): string {
  return legalLinkHref(url, "/privacy");
}

// Normal letter spacing even inside the booking pages' tighter text: the 13.5px size already matches Calendly's widths.
const LINK = "rounded-[4px] text-[13.5px] leading-5 font-semibold tracking-normal text-brand-strong hover:underline";

export function PublicFooterLinks({
  operatorEmail,
  pageUrl,
  showCookieSettings = true,
  className,
  showPrivacyPolicy = true,
  privacyUrl,
  listenForOpenEvent = true,
}: PublicFooterLinksProps) {
  const [open, setOpen] = useState(false);
  const href = useSyncExternalStore(noopSubscribe, () => pageUrl ?? window.location.href, () => pageUrl ?? "");
  useEffect(() => {
    if (!showCookieSettings || !listenForOpenEvent) return;
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpen);
  }, [showCookieSettings, listenForOpenEvent]);
  const privacyHref = privacyPolicyHref(privacyUrl);
  const external = /^https?:\/\//.test(privacyHref);
  return (
    <nav aria-label="Footer" className={cn("flex flex-wrap items-center gap-x-[34px] gap-y-2", className)}>
      {showCookieSettings && (
        <button type="button" onClick={() => setOpen(true)} className={cn(LINK, "min-[600px]:relative min-[600px]:-top-px")}>
          Cookie settings
        </button>
      )}
      {showPrivacyPolicy && (
        <a href={privacyHref} className={LINK} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          Privacy Policy
        </a>
      )}
      {operatorEmail && (
        <a href={reportAbuseHref(operatorEmail, href)} className={LINK}>
          Report abuse
        </a>
      )}
      {showCookieSettings && <CookieSettingsDialog open={open} onOpenChange={setOpen} />}
    </nav>
  );
}
