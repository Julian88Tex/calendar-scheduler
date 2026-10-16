// OWNER: foundation-ui.
//
// Cookie consent state for public pages (SPEC GEN-14): the visitor's choice per category (analytics, marketing),
// stored in localStorage for 365 days and broadcast with a window event so PublicTrackers (analytics) loads nothing
// before consent. When storage is blocked (third-party iframes) the choice lasts for the page view. Client only (safe
// to import on the server: no side effects at import time).

export type CookieConsent = "granted" | "denied" | "unknown";

/** Per-category decision (strictly necessary cookies are always on). */
export type CookieCategories = { analytics: boolean; marketing: boolean };

export const COOKIE_CONSENT_STORAGE_KEY = "kairos_cookie_consent";
/** window event fired with detail { consent, categories } whenever the visitor changes their choice. */
export const COOKIE_CONSENT_EVENT = "kairos:cookie_consent";
/** window event that asks the page to open the Cookie settings dialog. */
export const OPEN_COOKIE_SETTINGS_EVENT = "kairos:open_cookie_settings";
/** GEN-14: the choice persists for 365 days. */
export const COOKIE_CONSENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type Stored = { v: 1; analytics: boolean; marketing: boolean; at: number };

let memory: Stored | null = null;

/** Parses a stored value (current JSON shape or the legacy "granted" / "denied" strings); null when unset or expired. */
export function parseStoredConsent(raw: string | null, nowMs: number = Date.now()): CookieCategories | null {
  if (!raw) return null;
  if (raw === "granted") return { analytics: true, marketing: true };
  if (raw === "denied") return { analytics: false, marketing: false };
  try {
    const data = JSON.parse(raw) as Partial<Stored>;
    if (data?.v !== 1 || typeof data.at !== "number") return null;
    if (nowMs - data.at > COOKIE_CONSENT_TTL_MS) return null;
    return { analytics: data.analytics === true, marketing: data.marketing === true };
  } catch {
    return null;
  }
}

/** The visitor's per-category choice, or null when they have not chosen (or it expired). */
export function readCookieCategories(): CookieCategories | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = parseStoredConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
    if (parsed) return parsed;
  } catch {
    // storage blocked: fall back to the in-memory choice
  }
  return memory ? { analytics: memory.analytics, marketing: memory.marketing } : null;
}

/** Summary used by PublicTrackers: "granted" when analytics is allowed, "denied" when the visitor chose, else "unknown". */
export function readCookieConsent(): CookieConsent {
  const c = readCookieCategories();
  if (!c) return "unknown";
  return c.analytics ? "granted" : "denied";
}

/** Stores a choice: "granted" accepts every category, "denied" rejects non-essential ones, or pass categories. */
export function writeCookieConsent(consent: Exclude<CookieConsent, "unknown"> | CookieCategories): void {
  const categories: CookieCategories =
    typeof consent === "string" ? { analytics: consent === "granted", marketing: consent === "granted" } : consent;
  const stored: Stored = { v: 1, analytics: categories.analytics, marketing: categories.marketing, at: Date.now() };
  memory = stored;
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // storage blocked (third-party iframe): the choice lasts for this page view only
  }
  const summary: CookieConsent = categories.analytics ? "granted" : "denied";
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: { consent: summary, categories } }));
}

/** Asks the page's footer links to open the Cookie settings dialog. */
export function openCookieSettings(): void {
  window.dispatchEvent(new CustomEvent(OPEN_COOKIE_SETTINGS_EVENT));
}
