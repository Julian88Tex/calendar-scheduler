// OWNER: foundation-auth.
//
// JSuite single sign in (https://github.com/Julian88Tex/JSuite, docs/INTEGRATION.md). JSuite signs the user in with
// Google and sends them to /api/auth/jsuite with a one minute ES256 token whose `sub` is the Google subject, so the
// account resolves exactly like a "Continue with Google" login. Off unless JSUITE_URL is set.
import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { OAuthProfile } from "./oauth/types";

export const JSUITE_APP_ID = "joolinly";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export function jsuiteUrl(): string | null {
  return process.env.JSUITE_URL?.trim().replace(/\/$/, "") || null;
}

export async function verifyJsuiteToken(token: string): Promise<OAuthProfile> {
  const issuer = jsuiteUrl();
  if (!issuer) throw new Error("JSUITE_URL is not set");
  jwks ??= createRemoteJWKSet(new URL("/.well-known/jwks.json", issuer));
  const { payload } = await jwtVerify(token, jwks, { issuer, audience: JSUITE_APP_ID, algorithms: ["ES256"], maxTokenAge: "2m" });
  if (!payload.sub || typeof payload.email !== "string") throw new Error("JSuite token is missing claims");
  return {
    providerAccountId: payload.sub,
    email: payload.email,
    // JSuite only signs in Google accounts with a verified email.
    emailVerified: true,
    name: typeof payload.name === "string" ? payload.name : null,
    avatarUrl: typeof payload.picture === "string" ? payload.picture : null,
  };
}
