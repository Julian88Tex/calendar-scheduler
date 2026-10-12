// Security headers and framing policy (SPEC GEN-08, ARCHITECTURE section 4).
//
// Only pages meant to be embedded allow framing by any origin: landing pages /{handle}, booking pages
// /{handle}/{eventSlug}/** (including the details form), /d/**, the booking confirmation /booking/**, poll voter pages
// /p/** and routing forms /r/**. Everything else (dashboard, auth, setup, onboarding, marketing, cancel, reschedule and
// reconfirm pages, API) sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`. All responses send
// `Referrer-Policy: strict-origin-when-cross-origin` and `X-Content-Type-Options: nosniff`.
//
// This module is imported by next.config.ts through Node's native TypeScript loader: keep it dependency free, with
// erasable syntax only and no path aliases. src/proxy.ts may reuse securityHeadersFor().

/**
 * First path segments that are never a user or team handle and never embeddable. This is the GEN-02 reserved slug list
 * minus the embeddable prefixes (d, p, r, booking), plus app routes that are not reserved words (confirm-email).
 * Any other first segment is a handle (handles can never take a reserved word), so its pages are embeddable.
 */
export const NON_EMBEDDABLE_SEGMENTS: readonly string[] = [
  "app",
  "api",
  "admin",
  "auth",
  "login",
  "logout",
  "signup",
  "register",
  "onboarding",
  "setup",
  "settings",
  "invite",
  "oauth",
  "poll",
  "polls",
  "bookings",
  "events",
  "event",
  "cancellations",
  "reschedulings",
  "reconfirm",
  "embed",
  "embed.js",
  "widget.js",
  "widget",
  "team",
  "teams",
  "u",
  "s",
  "i",
  "help",
  "docs",
  "privacy",
  "terms",
  "cookie-policy",
  "payments",
  "cookies",
  "pricing",
  "features",
  "blog",
  "about",
  "contact",
  "support",
  "status",
  "health",
  "cron",
  "static",
  "public",
  "assets",
  "files",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "manifest.json",
  "apple-touch-icon.png",
  "verify-email",
  "reset-password",
  "forgot-password",
  "confirm-email",
  "me",
  "new",
  "null",
  "undefined",
  "www",
  "mail",
  "root",
  "system",
];

/** Embeddable fixed prefixes (in addition to handle pages). */
export const EMBEDDABLE_SEGMENTS: readonly string[] = ["d", "booking", "p", "r"];

export type HeaderPair = { key: string; value: string };

export const BASE_SECURITY_HEADERS: readonly HeaderPair[] = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

export const DENY_FRAMING_HEADERS: readonly HeaderPair[] = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

export const ALLOW_FRAMING_HEADERS: readonly HeaderPair[] = [
  { key: "Content-Security-Policy", value: "frame-ancestors *" },
];

/** First path segment, lowercased ("" for the root path). */
function firstSegment(pathname: string): string {
  const clean = pathname.split(/[?#]/)[0] ?? "";
  const seg = clean.replace(/^\/+/, "").split("/")[0] ?? "";
  try {
    return decodeURIComponent(seg).toLowerCase();
  } catch {
    return seg.toLowerCase();
  }
}

/** True when the page at this path may be framed by any origin. */
export function isEmbeddablePath(pathname: string): boolean {
  const seg = firstSegment(pathname);
  if (!seg) return false; // "/" is the marketing home
  if (EMBEDDABLE_SEGMENTS.includes(seg)) return true;
  return !NON_EMBEDDABLE_SEGMENTS.includes(seg);
}

/** Every security header for a response to this path. */
export function securityHeadersFor(pathname: string): HeaderPair[] {
  return [...BASE_SECURITY_HEADERS, ...(isEmbeddablePath(pathname) ? ALLOW_FRAMING_HEADERS : DENY_FRAMING_HEADERS)];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * next.config.ts headers() rules equivalent to securityHeadersFor(). path-to-regexp sources: the deny and allow rules
 * are mutually exclusive, so no header is ever set twice. (Next.js matches `source` case-sensitively; handles and
 * reserved routes are lowercase.)
 */
export function nextHeaderRules(): { source: string; headers: HeaderPair[] }[] {
  const denied = NON_EMBEDDABLE_SEGMENTS.map(escapeRegex).join("|");
  return [
    { source: "/:path*", headers: [...BASE_SECURITY_HEADERS] },
    { source: "/", headers: [...DENY_FRAMING_HEADERS] },
    { source: `/:segment(${denied})/:path*`, headers: [...DENY_FRAMING_HEADERS] },
    { source: `/:segment((?!(?:${denied})(?:/|$))[^/]+)/:path*`, headers: [...ALLOW_FRAMING_HEADERS] },
  ];
}
