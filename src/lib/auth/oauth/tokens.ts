// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Shared token helpers for the Google and Microsoft adapters: converts arctic's OAuth2Tokens into OAuthTokens (expiry
// on the business clock, granted scopes, missing refresh tokens as null) and maps arctic errors to OAuthProviderError
// (code "invalid_grant", "access_denied", "network", ...), which callers use to mark connections "Action required".
import "server-only";
import { ArcticFetchError, OAuth2RequestError, type OAuth2Tokens } from "arctic";
import { nowMs } from "@/lib/time/now";
import type { OAuthTokens } from "./types";

/** A failed token request (code exchange, refresh or revoke). */
export class OAuthProviderError extends Error {
  /** OAuth error code ("invalid_grant", "invalid_client", ...), "network" or "unexpected_response". */
  code: string;
  constructor(code: string, message?: string, options?: { cause?: unknown }) {
    super(message ?? `OAuth request failed: ${code}`, options);
    this.name = "OAuthProviderError";
    this.code = code;
  }
}

/** True when the refresh token is revoked or expired (the connection needs a reconnect). */
export function isInvalidGrant(e: unknown): boolean {
  return e instanceof OAuthProviderError && e.code === "invalid_grant";
}

/** Runs an arctic call and maps its errors to OAuthProviderError. */
export async function mapArcticErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OAuth2RequestError) throw new OAuthProviderError(e.code, e.description ?? e.message, { cause: e });
    if (e instanceof ArcticFetchError) throw new OAuthProviderError("network", "Could not reach the identity provider.", { cause: e });
    throw new OAuthProviderError("unexpected_response", e instanceof Error ? e.message : "Unexpected token response.", { cause: e });
  }
}

/** OAuthTokens from an arctic token response; `requestedScopes` stands in when the response omits `scope`. */
export function toOAuthTokens(t: OAuth2Tokens, requestedScopes: readonly string[]): OAuthTokens {
  const data = t.data as Record<string, unknown>;
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : Number(data.expires_in);
  const scope = typeof data.scope === "string" ? data.scope : null;
  return {
    accessToken: t.accessToken(),
    refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(nowMs() + expiresIn * 1000) : null,
    scopes: scope ? scope.split(/\s+/).filter(Boolean) : [...requestedScopes],
    idToken: typeof data.id_token === "string" ? data.id_token : null,
  };
}

/** The claims of a JWT (no signature check: id tokens come straight from the token endpoint over TLS). */
export function decodeJwtClaims(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new OAuthProviderError("invalid_id_token", "The id token is malformed.");
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    if (!claims || typeof claims !== "object") throw new Error("not an object");
    return claims as Record<string, unknown>;
  } catch (e) {
    throw new OAuthProviderError("invalid_id_token", "The id token is malformed.", { cause: e });
  }
}

export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
