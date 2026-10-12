// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// CookieBanner (ARCHITECTURE 20.2, SPEC GEN-14): shown only when a tracker is configured (GA4 or Meta Pixel) and the
// visitor has not chosen yet; nothing loads before consent. Hidden with hide_gdpr_banner=1 (BK-26).
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
  return () => window.removeEventListener(COOKIE_CONSENT_EVENT, cb);
};

export function CookieBanner({ trackersConfigured, onConsentChange }: CookieBannerProps) {
  const consent = useSyncExternalStore(subscribe, readCookieConsent, () => "granted" as CookieConsent);
  const [settings, setSettings] = useState(false);
  if (!trackersConfigured || consent !== "unknown") return null;
  const choose = (c: "granted" | "denied") => {
    writeCookieConsent(c);
    onConsentChange?.(c);
  };
  return (
    <div role="region" aria-label="Cookie consent" className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-3 border-t border-line bg-white p-4 text-body-md">
      <p>We use cookies to understand how this page is used.</p>
      <Button variant="secondary" size="sm" onClick={() => setSettings(true)}>
        Cookie settings
      </Button>
      <Button variant="secondary" size="sm" onClick={() => choose("denied")}>
        Reject all
      </Button>
      <Button size="sm" onClick={() => choose("granted")}>
        Accept all
      </Button>
      <CookieSettingsDialog open={settings} onOpenChange={setSettings} />
    </div>
  );
}
