// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Google OAuth (SPEC AU-02, CAL-02, MP-13; tech-reference 5.1): scopes and authorize parameters, the authorize URL
// (PKCE S256 through the arctic client from clients.ts), code exchange, refresh (Google usually returns no new refresh
// token: callers keep the stored one when refreshToken is null), revoke, and the profile from the id token.
// Sign-in and calendar connect share one client and one redirect URI; the voter free/busy check (poll_freebusy) asks
// for the free/busy scope only and no offline access.
import "server-only";
import { AppError } from "@/lib/errors";
import { getGoogleClient } from "./clients";
import { decodeJwtClaims, mapArcticErrors, str, toOAuthTokens } from "./tokens";
import type { OAuthIntent, OAuthProfile, OAuthTokens } from "./types";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

/** MP-13 "Check my calendar": free/busy only, tokens kept in memory. */
export const GOOGLE_FREEBUSY_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.freebusy"] as const;

/** Extra authorize parameters (refresh token on every consent, incremental auth). */
export const GOOGLE_AUTHORIZE_PARAMS: Readonly<Record<string, string>> = {
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: "true",
};

/** The scopes an intent asks for. */
export function googleScopesFor(intent: OAuthIntent): readonly string[] {
  return intent === "poll_freebusy" ? GOOGLE_FREEBUSY_SCOPES : GOOGLE_SCOPES;
}

function client() {
  const c = getGoogleClient();
  if (!c) throw new AppError("not_configured", "Sign in with Google is not configured on this server.");
  return c;
}

/** The Google authorize URL for a flow (state and PKCE verifier come from the start route). */
export function googleAuthorizationUrl(p: {
  state: string;
  codeVerifier: string;
  intent: OAuthIntent;
  loginHint?: string | null;
}): URL {
  const scopes = googleScopesFor(p.intent);
  const url = client().createAuthorizationURL(p.state, p.codeVerifier, [...scopes]);
  if (p.intent === "poll_freebusy") {
    url.searchParams.set("prompt", "select_account");
  } else {
    for (const [k, v] of Object.entries(GOOGLE_AUTHORIZE_PARAMS)) url.searchParams.set(k, v);
  }
  if (p.loginHint) url.searchParams.set("login_hint", p.loginHint);
  return url;
}

/** Exchanges the authorization code (throws OAuthProviderError). */
export async function exchangeGoogleCode(code: string, codeVerifier: string, intent: OAuthIntent = "login"): Promise<OAuthTokens> {
  const c = client();
  const t = await mapArcticErrors(() => c.validateAuthorizationCode(code, codeVerifier));
  return toOAuthTokens(t, googleScopesFor(intent));
}

/** Refreshes an access token. refreshToken in the result is null when Google did not rotate it (keep the old one). */
export async function refreshGoogleAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const c = client();
  const t = await mapArcticErrors(() => c.refreshAccessToken(refreshToken));
  return toOAuthTokens(t, GOOGLE_SCOPES);
}

/** Revokes a token at Google (best effort callers catch OAuthProviderError). */
export async function revokeGoogleToken(token: string): Promise<void> {
  const c = client();
  await mapArcticErrors(() => c.revokeToken(token));
}

/** The identity of a Google id token: sub, email, email_verified, name, picture. */
export function googleProfileFromIdToken(idToken: string): OAuthProfile {
  const claims = decodeJwtClaims(idToken);
  const sub = str(claims.sub);
  const email = str(claims.email);
  if (!sub || !email) throw new AppError("validation", "Your Google account did not share an email address.");
  return {
    providerAccountId: sub,
    email,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: str(claims.name) ?? ([str(claims.given_name), str(claims.family_name)].filter(Boolean).join(" ") || null),
    avatarUrl: str(claims.picture),
    tenantId: str(claims.hd),
    isWorkAccount: Boolean(str(claims.hd)),
  };
}
