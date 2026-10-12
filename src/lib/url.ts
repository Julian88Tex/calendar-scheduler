// URLs (ARCHITECTURE section 21, tech-reference 1.11, SPEC section 0.6).
//
// appUrl() is the canonical origin for links in emails, ICS files, OAuth redirect URIs and webhooks: APP_URL, else the
// Vercel production domain (production only), else the branch or deployment URL, else http://localhost:{PORT}. OAuth
// redirect URIs must be stable, so they always come from appUrl() (never VERCEL_URL directly).
// requestOrigin() is the origin of the current request (links shown back to the same user).
import { headers } from "next/headers";

/** Canonical origin without a trailing slash. */
export function appUrl(): string {
  const explicit = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_BRANCH_URL) return `https://${process.env.VERCEL_BRANCH_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/** Host of appUrl() ("kairos.example.com", "localhost:3000"). */
export function appHost(): string {
  return new URL(appUrl()).host;
}

/** True when appUrl() is served over https (Secure cookies). */
export function appUsesHttps(): boolean {
  return appUrl().startsWith("https://");
}

/** Origin of the current request, from the forwarded headers (falls back to appUrl() outside a request). */
export async function requestOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto =
      h.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
      (host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https");
    return host ? `${proto}://${host}` : appUrl();
  } catch {
    return appUrl();
  }
}

/** Absolute URL on appUrl() for a path ("/booking/123" -> "https://app.example.com/booking/123"). */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

type Query = Record<string, string | number | boolean | null | undefined>;

/** "?a=1&b=2" from an object (null, undefined and "" are skipped), or "" when empty. */
export function queryString(query?: Query | URLSearchParams | null): string {
  if (!query) return "";
  const params = query instanceof URLSearchParams ? new URLSearchParams(query) : new URLSearchParams();
  if (!(query instanceof URLSearchParams)) {
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined || v === "") continue;
      params.set(k, String(v));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Booking URL start segment: ISO 8601 UTC without milliseconds ("2026-10-13T18:00:00Z", SPEC 0.6). */
export function startParam(start: Date | string): string {
  const d = start instanceof Date ? start : new Date(start);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Parses a booking URL start segment; null when invalid. */
export function parseStartParam(value: string): Date | null {
  const decoded = decodeURIComponent(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/.test(decoded)) return null;
  const d = new Date(decoded);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type BookingTarget =
  /** Landing page or event booking page under a user or team handle: /{handle}[/{eventSlug}[/{start}]]. */
  | { handle: string; eventSlug?: string | null; start?: Date | string | null; query?: Query }
  /** Single-use link, one-off meeting or shared event type: /d/{code}[/{eventSlug}[/{start}]]. */
  | { code: string; eventSlug?: string | null; start?: Date | string | null; query?: Query };

/** Path of a public booking page (relative, for links on the same site). */
export function publicBookingPath(t: BookingTarget): string {
  const base = "code" in t ? `/d/${encodeURIComponent(t.code)}` : `/${encodeURIComponent(t.handle)}`;
  let path = base;
  if (t.eventSlug) {
    path += `/${encodeURIComponent(t.eventSlug)}`;
    if (t.start) path += `/${startParam(t.start)}`;
  }
  return path + queryString(t.query);
}

/** Absolute URL of a public booking page. */
export function publicBookingUrl(t: BookingTarget): string {
  return absoluteUrl(publicBookingPath(t));
}

/** Absolute URLs of an invitee's capability pages (SPEC 0.6). */
export function inviteeUrls(inviteeId: string): {
  confirmation: string;
  cancel: string;
  reschedule: string;
  reconfirm: string;
  ics: string;
} {
  const id = encodeURIComponent(inviteeId);
  return {
    confirmation: absoluteUrl(`/booking/${id}`),
    cancel: absoluteUrl(`/cancellations/${id}`),
    reschedule: absoluteUrl(`/reschedulings/${id}`),
    reconfirm: absoluteUrl(`/reconfirm/${id}`),
    ics: absoluteUrl(`/booking/${id}/event.ics`),
  };
}

/** Stable conferencing link /events/{scheduledEventId}/join (VID-11). */
export function joinUrl(scheduledEventId: string): string {
  return absoluteUrl(`/events/${encodeURIComponent(scheduledEventId)}/join`);
}

/** Meeting poll voting page /p/{slug}. */
export function pollUrl(slug: string): string {
  return absoluteUrl(`/p/${encodeURIComponent(slug)}`);
}

/** Routing form page /r/{slug}. */
export function routingFormUrl(slug: string): string {
  return absoluteUrl(`/r/${encodeURIComponent(slug)}`);
}

/** Uploaded file /api/files/{id} (absolute, for emails). */
export function fileAbsoluteUrl(fileId: string): string {
  return absoluteUrl(`/api/files/${encodeURIComponent(fileId)}`);
}

/**
 * Sanitizes a `?next=` return path (AU-04): only same-site relative paths are kept ("/app/meetings?x=1"); absolute
 * URLs, protocol-relative "//host" paths, backslash tricks and control characters fall back to `fallback`.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/app/scheduling"): string {
  if (!next || typeof next !== "string") return fallback;
  let value = next.trim();
  try {
    if (/%2f|%5c/i.test(value.slice(0, 6))) value = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, "http://same.invalid");
    if (parsed.host !== "same.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
