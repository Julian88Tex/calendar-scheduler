// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// OAuth state cookie (ARCHITECTURE section 18.4, SPEC AU-02): the start route stores the provider, the random state, the
// PKCE verifier, the intent, returnTo, the invitation token (accept_invitation), intent data and the signed-in user in
// one httpOnly, SameSite=Lax cookie for 10 minutes. The value is sealed with AES-256-GCM (encrypt() from
// src/lib/crypto.ts), so it can be neither read nor forged by the browser; the callback compares the state query
// parameter in constant time and clears the cookie whatever the outcome.
import "server-only";
import { decrypt, encrypt, timingSafeEqualStr } from "@/lib/crypto";
import { nowMs } from "@/lib/time/now";
import { appUsesHttps } from "@/lib/url";
import type { OAuthIntent, OAuthProviderId, OAuthState } from "./types";

export type { OAuthState } from "./types";

export const OAUTH_STATE_COOKIE = "kairos_oauth";
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
/** Both callbacks live under /api/auth, so the cookie never travels with other requests. */
export const OAUTH_STATE_COOKIE_PATH = "/api/auth";

/** Everything the callback needs, sealed into the cookie. */
export type StoredOAuthState = OAuthState & {
  v: 1;
  provider: OAuthProviderId;
  state: string;
  codeVerifier: string;
  /** The signed-in user who started the flow (connect_calendar, link_login_method), else null. */
  userId: string | null;
  /** Epoch ms after which the flow is rejected. */
  expiresAt: number;
};

const INTENTS: readonly OAuthIntent[] = [
  "login",
  "signup",
  "connect_calendar",
  "poll_freebusy",
  "compare_calendar",
  "link_login_method",
  "accept_invitation",
];

/** Cookie attributes for the state cookie (Lax: the provider's top-level redirect back must carry it). */
export function oauthStateCookieOptions(maxAgeSeconds = OAUTH_STATE_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: appUsesHttps() || process.env.NODE_ENV === "production",
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}

/** Seals a state for the cookie value. */
export async function sealOAuthState(s: Omit<StoredOAuthState, "v" | "expiresAt"> & { expiresAt?: number }): Promise<string> {
  const value: StoredOAuthState = { ...s, v: 1, expiresAt: s.expiresAt ?? nowMs() + OAUTH_STATE_MAX_AGE_SECONDS * 1000 };
  return encrypt(JSON.stringify(value));
}

function isStoredState(v: unknown): v is StoredOAuthState {
  const o = v as Partial<StoredOAuthState> | null;
  return Boolean(
    o &&
      o.v === 1 &&
      (o.provider === "google" || o.provider === "microsoft") &&
      typeof o.state === "string" &&
      typeof o.codeVerifier === "string" &&
      typeof o.expiresAt === "number" &&
      INTENTS.includes(o.intent as OAuthIntent),
  );
}

/** Opens a sealed cookie value; null when missing, tampered with, sealed with another key or malformed. */
export async function unsealOAuthState(value: string | null | undefined): Promise<StoredOAuthState | null> {
  if (!value || value.length > 8192) return null;
  try {
    const parsed = JSON.parse(await decrypt(value)) as unknown;
    return isStoredState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export type StateCheck =
  | { ok: true; state: StoredOAuthState }
  | { ok: false; reason: "missing" | "expired" | "mismatch"; state: StoredOAuthState | null };

/** Validates the callback's provider and `state` parameter against the sealed cookie. */
export function checkOAuthState(stored: StoredOAuthState | null, p: { provider: OAuthProviderId; state: string | null }): StateCheck {
  if (!stored) return { ok: false, reason: "missing", state: null };
  if (stored.expiresAt < nowMs()) return { ok: false, reason: "expired", state: stored };
  if (stored.provider !== p.provider || !p.state || !timingSafeEqualStr(stored.state, p.state)) {
    return { ok: false, reason: "mismatch", state: stored };
  }
  return { ok: true, state: stored };
}
