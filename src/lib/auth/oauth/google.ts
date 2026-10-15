// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Google OAuth (SPEC AU-02, CAL-02, MP-13; tech-reference 5.1): scopes and authorize parameters, the authorize URL
// (PKCE S256 through the arctic client from clients.ts), code exchange, refresh (Google usually returns no new refresh
// token: callers keep the stored one when refreshToken is null), revoke, and the profile from the id token.
// Sign-in, calendar connect and the voter check share one client and one redirect URI; each intent asks for what it
// needs (googleAccessFor):
// - "sign_in" (login, link_login_method, accept_invitation): openid, email and profile only, prompt=select_account, no
//   offline access and no include_granted_scopes. These scopes are not sensitive, so Google never shows its
//   unverified app warning on an everyday sign-in, and the token is used only to read the id token: the stored
//   calendar connection (tokens, scopes, Gmail permission, health) is never touched by a sign-in (intents.ts).
// - "full" (signup, connect_calendar, including every Reconnect and "Allow Gmail sending" link): the calendar scopes
//   and gmail.send (owner decision: booking emails are sent from the owner's own Gmail,
//   src/lib/email/gmail-transport.ts) with offline access and prompt=consent (a refresh token on every consent);
//   include_granted_scopes keeps earlier grants, and a grant without gmail.send (the box unchecked on Google's consent
//   screen) still connects the calendar.
// - "freebusy" (poll_freebusy, MP-13 "Check my calendar"): the free/busy scope only, no offline access.
import "server-only";
import { AppError } from "@/lib/errors";
import { GMAIL_SEND_SCOPE } from "@/lib/integrations/google/scopes";
import { getGoogleClient } from "./clients";
import { decodeJwtClaims, mapArcticErrors, str, toOAuthTokens } from "./tokens";
import type { OAuthIntent, OAuthProfile, OAuthTokens } from "./types";

/** Basic sign-in: who the user is (not sensitive scopes, no unverified app warning). */
export const GOOGLE_SIGN_IN_SCOPES = ["openid", "email", "profile"] as const;

/** Signup and calendar connect: sign-in plus the calendar scopes and gmail.send. */
export const GOOGLE_SCOPES = [
  ...GOOGLE_SIGN_IN_SCOPES,
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  GMAIL_SEND_SCOPE,
] as const;

/** MP-13 "Check my calendar": free/busy only, tokens kept in memory. */
export const GOOGLE_FREEBUSY_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.freebusy"] as const;

/** Extra authorize parameters of the full flows (refresh token on every consent, incremental auth). */
export const GOOGLE_AUTHORIZE_PARAMS: Readonly<Record<string, string>> = {
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: "true",
};

/** Extra authorize parameters of a basic sign-in and the voter check: pick an account, no offline access. */
export const GOOGLE_SIGN_IN_AUTHORIZE_PARAMS: Readonly<Record<string, string>> = { prompt: "select_account" };

/** What a Google flow asks for (see the file header). */
export type GoogleAccess = "sign_in" | "full" | "freebusy";

/** The access an intent asks for: only signup and connect_calendar ask for the calendar and Gmail. */
export function googleAccessFor(intent: OAuthIntent): GoogleAccess {
  switch (intent) {
    case "signup":
    case "connect_calendar":
      return "full";
    case "poll_freebusy":
      return "freebusy";
    case "login":
    case "link_login_method":
    case "accept_invitation":
    default:
      return "sign_in";
  }
}

/** The scopes an intent asks for. */
export function googleScopesFor(intent: OAuthIntent): readonly string[] {
  const access = googleAccessFor(intent);
  return access === "full" ? GOOGLE_SCOPES : access === "freebusy" ? GOOGLE_FREEBUSY_SCOPES : GOOGLE_SIGN_IN_SCOPES;
}

/** The extra authorize parameters of an intent. */
export function googleAuthorizeParamsFor(intent: OAuthIntent): Readonly<Record<string, string>> {
  return googleAccessFor(intent) === "full" ? GOOGLE_AUTHORIZE_PARAMS : GOOGLE_SIGN_IN_AUTHORIZE_PARAMS;
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
  for (const [k, v] of Object.entries(googleAuthorizeParamsFor(p.intent))) url.searchParams.set(k, v);
  if (p.loginHint) url.searchParams.set("login_hint", p.loginHint);
  return url;
}

/** Exchanges the authorization code (throws OAuthProviderError). */
export async function exchangeGoogleCode(code: string, codeVerifier: string, intent: OAuthIntent = "login"): Promise<OAuthTokens> {
  const c = client();
  const t = await mapArcticErrors(() => c.validateAuthorizationCode(code, codeVerifier));
  return toOAuthTokens(t, googleScopesFor(intent));
}

/**
 * Refreshes an access token. refreshToken in the result is null when Google did not rotate it (keep the old one).
 * scopes is empty when the response omits `scope`: the refresh never widens a grant, so callers keep the stored scopes
 * (assuming the requested list would claim gmail.send for accounts that never granted it).
 */
export async function refreshGoogleAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const c = client();
  const t = await mapArcticErrors(() => c.refreshAccessToken(refreshToken));
  return toOAuthTokens(t, []);
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
