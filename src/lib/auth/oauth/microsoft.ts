// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Microsoft identity platform OAuth (SPEC AU-03, CAL-03, MP-13; tech-reference 5.1): scopes, the authorize URL
// (tenant MICROSOFT_TENANT, default "common", PKCE S256 through the arctic client), code exchange, refresh (scopes
// required; Microsoft rotates refresh tokens, so callers always persist the newest one) and the profile from the id
// token. The templated `common` issuer is never validated against a fixed string.
//
// Email trust (account linking by email, invitation matching): the `email` claim of work and school accounts is set by
// the tenant and is not verified, so it is trusted only for personal accounts (consumer tenant) or when the optional
// `xms_edov` (email domain owner verified) claim is true; otherwise the user principal name (preferred_username,
// whose domain the tenant has verified) is used as the verified address.
import "server-only";
import { AppError } from "@/lib/errors";
import { getMicrosoftClient } from "./clients";
import { decodeJwtClaims, mapArcticErrors, str, toOAuthTokens } from "./tokens";
import type { OAuthIntent, OAuthProfile, OAuthTokens } from "./types";

export const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
  "OnlineMeetings.ReadWrite",
] as const;

/** MP-13 "Check my calendar": read the calendar view only, no refresh token. */
export const MICROSOFT_FREEBUSY_SCOPES = ["openid", "profile", "email", "Calendars.Read"] as const;

/** Tenant id of personal Microsoft accounts (consumers). */
export const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

/** The scopes an intent asks for. */
export function microsoftScopesFor(intent: OAuthIntent): readonly string[] {
  return intent === "poll_freebusy" || intent === "compare_calendar" ? MICROSOFT_FREEBUSY_SCOPES : MICROSOFT_SCOPES;
}

function client() {
  const c = getMicrosoftClient();
  if (!c) throw new AppError("not_configured", "Sign in with Microsoft is not configured on this server.");
  return c;
}

/** The Microsoft authorize URL for a flow. */
export function microsoftAuthorizationUrl(p: {
  state: string;
  codeVerifier: string;
  intent: OAuthIntent;
  loginHint?: string | null;
}): URL {
  const url = client().createAuthorizationURL(p.state, p.codeVerifier, [...microsoftScopesFor(p.intent)]);
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("response_mode", "query");
  if (p.loginHint) url.searchParams.set("login_hint", p.loginHint);
  return url;
}

/** Exchanges the authorization code (throws OAuthProviderError). */
export async function exchangeMicrosoftCode(code: string, codeVerifier: string, intent: OAuthIntent = "login"): Promise<OAuthTokens> {
  const c = client();
  const t = await mapArcticErrors(() => c.validateAuthorizationCode(code, codeVerifier));
  return toOAuthTokens(t, microsoftScopesFor(intent));
}

/** Refreshes an access token; the result carries the rotated refresh token (persist it). */
export async function refreshMicrosoftAccessToken(refreshToken: string, scopes: readonly string[] = MICROSOFT_SCOPES): Promise<OAuthTokens> {
  const c = client();
  const t = await mapArcticErrors(() => c.refreshAccessToken(refreshToken, [...scopes]));
  return toOAuthTokens(t, scopes);
}

const isEmailish = (v: string | null): v is string => Boolean(v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v));

/** The identity of a Microsoft id token (see the email trust rules in the file header). */
export function microsoftProfileFromIdToken(idToken: string): OAuthProfile {
  const claims = decodeJwtClaims(idToken);
  const providerAccountId = str(claims.oid) ?? str(claims.sub);
  const tenantId = str(claims.tid);
  const consumer = tenantId === MICROSOFT_CONSUMER_TENANT_ID;
  const emailClaim = str(claims.email);
  const upn = [str(claims.preferred_username), str(claims.upn)].find(isEmailish) ?? null;
  const edov = claims.xms_edov === true || claims.xms_edov === "true" || claims.xms_edov === 1 || claims.xms_edov === "1";

  let email: string | null = null;
  let emailVerified = false;
  if (consumer) {
    email = isEmailish(emailClaim) ? emailClaim : upn;
    emailVerified = Boolean(email);
  } else if (isEmailish(emailClaim) && edov) {
    email = emailClaim;
    emailVerified = true;
  } else if (upn) {
    email = upn;
    emailVerified = true;
  } else if (isEmailish(emailClaim)) {
    email = emailClaim;
    emailVerified = false;
  }
  if (!providerAccountId || !email) {
    throw new AppError("validation", "Your Microsoft account did not share an email address.");
  }
  return {
    providerAccountId,
    email,
    emailVerified,
    name: str(claims.name),
    avatarUrl: null,
    tenantId,
    isWorkAccount: Boolean(tenantId) && !consumer,
  };
}
