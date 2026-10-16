// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Redirect helpers for the OAuth routes: 303 responses (no-store) to absolute URLs on appUrl(), query helpers for
// same-site paths, and where each intent sends its errors:
//   login -> /login?error={code}&provider=..., signup -> /signup?error=..., accept_invitation -> /invite/{token}?error=...,
//   connect_calendar -> returnTo or /app/availability/calendar-settings with ?oauth_error=...,
//   link_login_method -> returnTo or /app/settings/login with ?oauth_error=..., poll_freebusy and
//   compare_calendar -> returnTo with ?oauth_error=...
import "server-only";
import { absoluteUrl, safeNextPath } from "@/lib/url";
import type { OAuthErrorCode } from "./errors";
import type { OAuthIntent, OAuthProviderId, OAuthState } from "./types";

/** A 303 redirect to a same-site path or an absolute URL. Cookies set through next/headers are added by Next. */
export function redirectResponse(location: string | URL, status: 302 | 303 | 307 = 303): Response {
  const href = location instanceof URL ? location.toString() : absoluteUrl(location);
  return new Response(null, { status, headers: { Location: href, "Cache-Control": "no-store, max-age=0" } });
}

/** Adds query parameters to a same-site path ("/a?x=1" + { y: 2 } -> "/a?x=1&y=2"). */
export function appendQuery(path: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(path, "http://same.invalid");
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") u.searchParams.set(k, v);
  return `${u.pathname}${u.search}${u.hash}`;
}

const RETURN_DEFAULTS: Partial<Record<OAuthIntent, string>> = {
  connect_calendar: "/app/availability/calendar-settings",
  link_login_method: "/app/settings/login",
  poll_freebusy: "/",
  compare_calendar: "/",
};

/** Where an intent sends a failure (see the file header). */
export function oauthErrorRedirect(
  intent: OAuthIntent,
  state: Pick<OAuthState, "returnTo" | "invitationToken"> | null,
  provider: OAuthProviderId,
  code: OAuthErrorCode,
): string {
  switch (intent) {
    case "signup":
      return appendQuery("/signup", { error: code, provider });
    case "accept_invitation":
      return state?.invitationToken
        ? appendQuery(`/invite/${encodeURIComponent(state.invitationToken)}`, { error: code, provider })
        : appendQuery("/login", { error: code, provider });
    case "connect_calendar":
    case "link_login_method":
    case "poll_freebusy":
    case "compare_calendar": {
      const base = safeNextPath(state?.returnTo, RETURN_DEFAULTS[intent] ?? "/");
      return appendQuery(base, { oauth_error: code, provider });
    }
    case "login":
    default:
      return appendQuery("/login", { error: code, provider, next: state?.returnTo ?? undefined });
  }
}
