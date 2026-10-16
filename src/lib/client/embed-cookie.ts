// Client side of embed-safe cookies (ARCHITECTURE sections 17 and 18.5, SPEC GEN-08).
//
// Inside third-party iframes browsers may block even SameSite=None; Partitioned cookies. Pages mirror the value they
// received (booking "Remember this device" token, poll edit token) in localStorage and send it back in the
// `x-kairos-fallback-{name}` header; readEmbedSafeCookie() (src/lib/cookies.ts) accepts either. Client and server safe
// (no React, no DOM access at import time).

export const FALLBACK_HEADER_PREFIX = "x-kairos-fallback-";
const STORAGE_PREFIX = "kairos:cookie:";

/** Header name carrying the localStorage copy of cookie `name`. */
export function fallbackHeaderName(name: string): string {
  return `${FALLBACK_HEADER_PREFIX}${name.toLowerCase()}`;
}

type Stored = { value: string; expiresAt: number };

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // blocked storage (Safari private mode, sandboxed iframes)
  }
}

/** Remembers a cookie value (from a server response) for `maxAgeSeconds`. */
export function rememberFallbackCookie(name: string, value: string, maxAgeSeconds: number): void {
  const s = storage();
  if (!s) return;
  try {
    const entry: Stored = { value, expiresAt: Date.now() + maxAgeSeconds * 1000 };
    s.setItem(STORAGE_PREFIX + name, JSON.stringify(entry));
  } catch {
    // quota or blocked storage: the cookie may still work
  }
}

/** The remembered value, or null when missing or expired. */
export function readFallbackCookie(name: string): string | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(STORAGE_PREFIX + name);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Stored;
    if (!entry || typeof entry.value !== "string" || entry.expiresAt < Date.now()) {
      s.removeItem(STORAGE_PREFIX + name);
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

export function forgetFallbackCookie(name: string): void {
  try {
    storage()?.removeItem(STORAGE_PREFIX + name);
  } catch {
    // ignore
  }
}

/** Headers to add to a fetch so the server can read the remembered values of these cookies. */
export function fallbackCookieHeaders(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const v = readFallbackCookie(name);
    if (v) out[fallbackHeaderName(name)] = v;
  }
  return out;
}
