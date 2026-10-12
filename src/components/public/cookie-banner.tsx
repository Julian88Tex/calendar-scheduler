// OWNER: foundation-ui.
//
// CookieBanner (ARCHITECTURE 20.2, SPEC GEN-14): shown on public pages only when the host configured a tracker (GA4 or
// Meta Pixel) and the visitor has not chosen yet; trackers load only after consent. Hidden with hide_gdpr_banner=1
// (BK-26: the caller skips it). Buttons: "Accept all", "Reject non-essential" and "Cookie settings".
"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "../ui/button";
import { COOKIE_CONSENT_EVENT, readCookieConsent, writeCookieConsent, type CookieConsent } from "./cookie-consent";
import { CookieSettingsDialog } from "./cookie-settings-dialog";

export type CookieBannerProps = {
  /** True when the host configured a tracker; without one the banner never renders. */
  trackersConfigured: boolean;
  onConsentChange?: (consent: Exclude<CookieConsent, "unknown">) => void;
};

const subscribe = (cb: () => void) => {
  window.addEventListener(COOKIE_CONSENT_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(COOKIE_CONSENT_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};

export function CookieBanner({ trackersConfigured, onConsentChange }: CookieBannerProps) {
  // Server and hydration render nothing ("granted" snapshot); the client decides after hydration.
  const consent = useSyncExternalStore(subscribe, readCookieConsent, () => "granted" as CookieConsent);
  const [settings, setSettings] = useState(false);
  if (!trackersConfigured) return null;
  const choose = (c: "granted" | "denied") => {
    writeCookieConsent(c);
    onConsentChange?.(c);
  };
  return (
    <>
      {consent === "unknown" && (
        <div
          role="region"
          aria-label="Cookie consent"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white px-4 py-4 shadow-[0_-2px_15px_rgba(0,0,0,0.08)] sm:px-6"
        >
          <div className="mx-auto flex max-w-[1060px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] leading-5 text-ink">
              This page uses cookies to measure visits and bookings. You can accept them, reject non-essential cookies or choose by category.
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="tertiary" size="sm" onClick={() => setSettings(true)}>
                Cookie settings
              </Button>
              <Button variant="secondary" size="sm" onClick={() => choose("denied")}>
                Reject non-essential
              </Button>
              <Button size="sm" onClick={() => choose("granted")}>
                Accept all
              </Button>
            </div>
          </div>
        </div>
      )}
      <CookieSettingsDialog open={settings} onOpenChange={setSettings} />
    </>
  );
}
