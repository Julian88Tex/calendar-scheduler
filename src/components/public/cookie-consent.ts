// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Cookie consent state for public pages (SPEC GEN-14): stored in localStorage, broadcast with a window event so
// PublicTrackers (analytics) loads nothing before consent. Client only (safe to import on the server: no side effects).

export type CookieConsent = "granted" | "denied" | "unknown";

export const COOKIE_CONSENT_STORAGE_KEY = "kairos_cookie_consent";
/** window event fired with detail { consent } whenever the visitor changes their choice. */
export const COOKIE_CONSENT_EVENT = "kairos:cookie_consent";
/** window event that asks the page to open the Cookie settings dialog. */
export const OPEN_COOKIE_SETTINGS_EVENT = "kairos:open_cookie_settings";

export function readCookieConsent(): CookieConsent {
  if (typeof window === "undefined") return "unknown";
  try {
    const v = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    return v === "granted" || v === "denied" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

export function writeCookieConsent(consent: Exclude<CookieConsent, "unknown">): void {
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, consent);
  } catch {
    // storage blocked (third-party iframe): the choice lasts for this page view only
  }
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: { consent } }));
}
