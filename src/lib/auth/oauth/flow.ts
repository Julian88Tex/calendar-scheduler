// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// The shared Google and Microsoft OAuth routes (ARCHITECTURE sections 10.4 and 18.4, SPEC AU-02, AU-03):
//
// GET /api/auth/{provider}/start?intent=&next=&invitation=&tz=&...
//   - on another host than APP_URL, first moves to the same URL on APP_URL (the state cookie and the registered
//     redirect URI must share one host);
//   - unconfigured provider: back with error not_configured; connect_calendar and link_login_method need a signed-in
//     user (else /login?next=<this start URL>), link_login_method also the AU-10 confirmation (?confirm=, from
//     verifyLoginMethodCode); accept_invitation needs a pending invitation (its email becomes the login_hint);
//     connect_calendar with data.reconnect = one of the user's calendar connection ids uses that account's email as
//     the login_hint (the "Reconnect" links preselect the right Google account);
//   - stores provider, state, PKCE verifier, intent, returnTo, invitation token, data and user id in the sealed
//     10-minute state cookie and redirects to the provider (PKCE S256, scopes per intent).
//
// GET /api/auth/{provider}/callback?code=&state= (or ?error=access_denied)
//   - reads and always clears the state cookie, checks provider, expiry and state in constant time;
//   - "access_denied" from the provider: "{Provider} sign in was canceled.";
//   - exchanges the code, decodes the id token into an OAuthProfile and dispatches the intent (intents.ts).
import "server-only";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { calendarConnections } from "@/db/schema";
import { isUuid } from "@/lib/ids";
import { log } from "@/lib/logger";
import { getPendingInvitation } from "@/lib/teams";
import { appHost, absoluteUrl, safeNextPath } from "@/lib/url";
import { isValidTimeZone } from "@/lib/validation";
import { checkLoginMethodConfirmation } from "../flows/login-method-code";
import { getCurrentUser } from "../session";
import { getGoogleClient, getMicrosoftClient } from "./clients";
import type { OAuthErrorCode } from "./errors";
import { exchangeGoogleCode, googleAuthorizationUrl, googleProfileFromIdToken } from "./google";
import { dispatchOAuthIntent, isOAuthIntent } from "./intents";
import { OAUTH_START_RESERVED_PARAMS } from "./links";
import { exchangeMicrosoftCode, microsoftAuthorizationUrl, microsoftProfileFromIdToken } from "./microsoft";
import { generateCodeVerifier, generateState } from "./pkce";
import { appendQuery, oauthErrorRedirect, redirectResponse } from "./redirects";
import {
  OAUTH_STATE_COOKIE,
  checkOAuthState,
  oauthStateCookieOptions,
  sealOAuthState,
  unsealOAuthState,
} from "./state";
import type { OAuthCallbackContext, OAuthIntent, OAuthProfile, OAuthProviderId, OAuthTokens } from "./types";

const MAX_DATA_ENTRIES = 8;
const DATA_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const HOP_PARAM = "_canonical";

/** True when the provider has a client id and secret. */
export function isProviderConfigured(provider: OAuthProviderId): boolean {
  return provider === "google" ? Boolean(getGoogleClient()) : Boolean(getMicrosoftClient());
}

function hostnameOf(host: string | null): string | null {
  return host ? host.replace(/:\d+$/, "").toLowerCase() : null;
}

function requestHostName(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return hostnameOf(forwarded || request.headers.get("host") || new URL(request.url).host);
}

/** Intent data from the extra start parameters (bounded). */
function readData(params: URLSearchParams): Record<string, string> {
  const data: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of params) {
    if ((OAUTH_START_RESERVED_PARAMS as readonly string[]).includes(k) || !DATA_KEY.test(k) || k in data) continue;
    if (v.length > 512 || ++n > MAX_DATA_ENTRIES) continue;
    data[k] = v;
  }
  return data;
}

/** The account email of one of the user's calendar connections (the reconnect target), or null. */
async function reconnectLoginHint(userId: string, connectionId: string | undefined): Promise<string | null> {
  if (!connectionId || !isUuid(connectionId)) return null;
  const db = await getDb();
  const [row] = await db
    .select({ accountEmail: calendarConnections.accountEmail })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.userId, userId)))
    .limit(1);
  return row?.accountEmail || null;
}

/** GET /api/auth/{provider}/start (see the file header). */
export async function handleOAuthStart(request: Request, provider: OAuthProviderId): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;

  // One canonical host for the cookie and the redirect URI (not for localhost aliases in development). The hop marker
  // prevents a loop behind a proxy that rewrites the Host header.
  const reqHost = requestHostName(request);
  const canonical = hostnameOf(appHost());
  const local = (h: string | null) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  if (reqHost && canonical && reqHost !== canonical && !(local(reqHost) && local(canonical)) && !params.has(HOP_PARAM)) {
    const target = new URL(`${url.pathname}${url.search}`, absoluteUrl("/"));
    target.searchParams.set(HOP_PARAM, "1");
    return redirectResponse(target, 307);
  }
  params.delete(HOP_PARAM);

  const rawIntent = params.get("intent") ?? "login";
  const intent: OAuthIntent = isOAuthIntent(rawIntent) ? rawIntent : "login";
  const returnTo = safeNextPath(params.get("next"), "") || null;
  const invitationToken = params.get("invitation")?.slice(0, 200) || null;
  const tz = params.get("tz");
  const data = readData(params);
  if (tz && isValidTimeZone(tz)) data.tz = tz;
  const errorTo = (code: OAuthErrorCode) => redirectResponse(oauthErrorRedirect(intent, { returnTo, invitationToken }, provider, code));

  if (!isProviderConfigured(provider)) return errorTo("not_configured");
  // The booking page calendar compare is Google only for now.
  if (intent === "compare_calendar" && provider !== "google") return errorTo("not_configured");

  let userId: string | null = null;
  if (intent === "connect_calendar" || intent === "link_login_method") {
    const user = await getCurrentUser();
    if (!user) return redirectResponse(appendQuery("/login", { next: `${url.pathname}${url.search}` }));
    userId = user.id;
    // AU-10: a new sign-in method needs the confirmation of the code emailed to the login address.
    if (intent === "link_login_method" && !(await checkLoginMethodConfirmation(user.id, params.get("confirm")))) {
      return errorTo("confirmation_required");
    }
  }

  let loginHint: string | null = null;
  if (intent === "accept_invitation") {
    const invitation = invitationToken ? await getPendingInvitation(invitationToken) : null;
    if (!invitation) return errorTo("invitation_invalid");
    loginHint = invitation.email;
  } else if (intent === "connect_calendar" && userId) {
    loginHint = await reconnectLoginHint(userId, data.reconnect);
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const sealed = await sealOAuthState({ provider, state, codeVerifier, intent, returnTo, invitationToken, data, userId });
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, sealed, oauthStateCookieOptions());

  const authorizeUrl =
    provider === "google"
      ? googleAuthorizationUrl({ state, codeVerifier, intent, loginHint, data })
      : microsoftAuthorizationUrl({ state, codeVerifier, intent, loginHint });
  return redirectResponse(authorizeUrl, 302);
}

async function exchangeAndDecode(
  provider: OAuthProviderId,
  code: string,
  codeVerifier: string,
  intent: OAuthIntent,
): Promise<{ tokens: OAuthTokens; profile: OAuthProfile }> {
  const tokens =
    provider === "google" ? await exchangeGoogleCode(code, codeVerifier, intent) : await exchangeMicrosoftCode(code, codeVerifier, intent);
  if (!tokens.idToken) throw new Error("token response without id_token");
  const profile = provider === "google" ? googleProfileFromIdToken(tokens.idToken) : microsoftProfileFromIdToken(tokens.idToken);
  return { tokens, profile };
}

/** GET /api/auth/{provider}/callback (see the file header). */
export async function handleOAuthCallback(request: Request, provider: OAuthProviderId): Promise<Response> {
  const url = new URL(request.url);
  const jar = await cookies();
  const stored = await unsealOAuthState(jar.get(OAUTH_STATE_COOKIE)?.value);
  jar.set(OAUTH_STATE_COOKIE, "", oauthStateCookieOptions(0));

  const check = checkOAuthState(stored, { provider, state: url.searchParams.get("state") });
  const intent: OAuthIntent = check.state?.intent ?? "login";
  const errorTo = (code: OAuthErrorCode) => redirectResponse(oauthErrorRedirect(intent, check.state, provider, code));
  if (!check.ok) {
    log.warn("oauth.state_rejected", { provider, reason: check.reason });
    return errorTo("expired");
  }
  const s = check.state;

  const providerError = url.searchParams.get("error");
  if (providerError) {
    const canceled = ["access_denied", "consent_required", "interaction_required", "user_cancelled"].includes(providerError);
    if (!canceled) log.warn("oauth.provider_error", { provider, error: providerError });
    return errorTo(canceled ? "canceled" : "failed");
  }
  const code = url.searchParams.get("code");
  if (!code || code.length > 4096) return errorTo("failed");
  if (!isProviderConfigured(provider)) return errorTo("not_configured");

  let tokens: OAuthTokens;
  let profile: OAuthProfile;
  try {
    ({ tokens, profile } = await exchangeAndDecode(provider, code, s.codeVerifier, s.intent));
  } catch (e) {
    const noEmail = (e as { code?: unknown } | null)?.code === "validation";
    if (!noEmail) log.error("oauth.exchange_failed", { provider, intent: s.intent, error: e });
    return errorTo(noEmail ? "no_email" : "failed");
  }

  let userId: string | null = null;
  if (s.intent === "connect_calendar" || s.intent === "link_login_method") {
    const user = await getCurrentUser();
    userId = user && user.id === s.userId ? user.id : null;
  }

  const ctx: OAuthCallbackContext = {
    request,
    provider,
    intent: s.intent,
    tokens,
    profile,
    state: { intent: s.intent, returnTo: s.returnTo, invitationToken: s.invitationToken ?? null, data: s.data ?? {} },
    returnTo: s.returnTo,
    userId,
  };
  return dispatchOAuthIntent(ctx);
}
