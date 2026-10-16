// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Dependency-free PKCE helper (tech-reference 5.2, verified): a drop-in fallback for arctic (deprecated on npm) so
// clients.ts can switch implementations without touching callers. Its Google authorize URL is byte-identical to arctic.
import { createHash, randomBytes } from "node:crypto";

export const generateState = () => randomBytes(32).toString("base64url");
export const generateCodeVerifier = () => randomBytes(32).toString("base64url");
export const codeChallengeS256 = (v: string) => createHash("sha256").update(v).digest("base64url");

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
};

export function buildAuthorizeUrl(
  endpoint: string,
  p: { clientId: string; redirectUri: string; state: string; codeVerifier: string; scopes: string[]; extra?: Record<string, string> },
): URL {
  const u = new URL(endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("code_challenge", codeChallengeS256(p.codeVerifier));
  if (p.scopes.length) u.searchParams.set("scope", p.scopes.join(" "));
  for (const [k, v] of Object.entries(p.extra ?? {})) u.searchParams.set(k, v);
  return u;
}

/** POSTs a token request with client_secret_basic. Throws Error("oauth_token_error ...") on failure. */
export async function tokenRequest(
  endpoint: string,
  clientId: string,
  clientSecret: string,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetch(endpoint, {
    method: "POST",
    body: new URLSearchParams(body),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization:
        "Basic " + Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64"),
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    throw new Error(`oauth_token_error ${res.status} ${String(json.error ?? "")}`);
  }
  return json as unknown as TokenResponse;
}

export const decodeJwtPayload = <T = Record<string, unknown>>(jwt: string): T =>
  JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as T;
