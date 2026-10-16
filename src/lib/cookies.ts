// Cookies that must work inside third-party embeds (ARCHITECTURE sections 17, 18.5 and 21; SPEC GEN-08).
//
// setEmbedSafeCookie(): in embed mode `SameSite=None; Secure; Partitioned` (CHIPS), otherwise `SameSite=Lax` (Secure
// when the app runs on https). Always httpOnly. Only callable where Next allows setting cookies (Server Actions and
// Route Handlers). For a Response you build yourself, use serializeEmbedSafeCookie() / appendEmbedSafeCookie().
// readEmbedSafeCookie(): the cookie, or the `x-kairos-fallback-{name}` header the client sends from localStorage when
// the browser blocked the cookie (src/lib/client/embed-cookie.ts).
//
// Used for the booking "Remember this device" token and the poll edit token; first-party cookies (session, OAuth
// state) stay SameSite=Lax and are not set through here.
import { cookies } from "next/headers";
import { fallbackHeaderName } from "./client/embed-cookie";
import { appUsesHttps } from "./url";

export type EmbedSafeCookieOptions = {
  maxAgeSeconds: number;
  path?: string;
  /** True when the page runs inside an embed (the page passes embed=1 to its action or route handler). */
  embed?: boolean;
};

export type CookieAttributes = {
  httpOnly: true;
  sameSite: "none" | "lax";
  secure: boolean;
  partitioned: boolean;
  path: string;
  maxAge: number;
};

/** The attributes setEmbedSafeCookie() uses (exported for tests and custom responses). */
export function embedSafeCookieAttributes(opts: EmbedSafeCookieOptions): CookieAttributes {
  const embed = Boolean(opts.embed);
  return {
    httpOnly: true,
    sameSite: embed ? "none" : "lax",
    // SameSite=None requires Secure; browsers accept Secure cookies on http://localhost.
    secure: embed || appUsesHttps() || process.env.NODE_ENV === "production",
    partitioned: embed,
    path: opts.path ?? "/",
    maxAge: Math.max(0, Math.floor(opts.maxAgeSeconds)),
  };
}

/** Sets the cookie on the current Server Action or Route Handler response. */
export async function setEmbedSafeCookie(name: string, value: string, opts: EmbedSafeCookieOptions): Promise<void> {
  const jar = await cookies();
  jar.set(name, value, embedSafeCookieAttributes(opts));
}

/** Deletes an embed-safe cookie (same path and attributes so the browser matches it). */
export async function deleteEmbedSafeCookie(name: string, opts: Omit<EmbedSafeCookieOptions, "maxAgeSeconds"> = {}): Promise<void> {
  const jar = await cookies();
  jar.set(name, "", { ...embedSafeCookieAttributes({ ...opts, maxAgeSeconds: 0 }), maxAge: 0 });
}

/** A Set-Cookie header value for a hand-built Response. */
export function serializeEmbedSafeCookie(name: string, value: string, opts: EmbedSafeCookieOptions): string {
  const a = embedSafeCookieAttributes(opts);
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${a.path}`, `Max-Age=${a.maxAge}`, "HttpOnly"];
  parts.push(a.sameSite === "none" ? "SameSite=None" : "SameSite=Lax");
  if (a.secure) parts.push("Secure");
  if (a.partitioned) parts.push("Partitioned");
  if (a.maxAge === 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  return parts.join("; ");
}

/** Appends the cookie to a Response's headers. */
export function appendEmbedSafeCookie(response: Response, name: string, value: string, opts: EmbedSafeCookieOptions): Response {
  response.headers.append("Set-Cookie", serializeEmbedSafeCookie(name, value, opts));
  return response;
}

/** Parses a Cookie header into a map (first occurrence wins). */
export function parseCookieHeader(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    if (!key || out.has(key)) continue;
    const raw = part.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
    try {
      out.set(key, decodeURIComponent(raw));
    } catch {
      out.set(key, raw);
    }
  }
  return out;
}

/**
 * The cookie value from the request, falling back to the `x-kairos-fallback-{name}` header (localStorage copy in
 * embeds). Treat the value like any client input: it is a token that must still be verified server side.
 */
export function readEmbedSafeCookie(request: Request | { headers: Headers }, name: string): string | null {
  const fromCookie = parseCookieHeader(request.headers.get("cookie")).get(name);
  if (fromCookie) return fromCookie;
  const fallback = request.headers.get(fallbackHeaderName(name))?.trim();
  return fallback ? fallback.slice(0, 4096) : null;
}

/** Same as readEmbedSafeCookie() for Server Actions (reads next/headers). */
export async function readEmbedSafeCookieFromHeaders(name: string): Promise<string | null> {
  const { headers } = await import("next/headers");
  const h = await headers();
  return readEmbedSafeCookie({ headers: new Headers(h) }, name);
}
