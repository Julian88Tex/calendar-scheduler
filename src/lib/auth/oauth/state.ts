// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// OAuth state cookie (ARCHITECTURE section 18.4): intent, PKCE verifier, state, returnTo and the invitation token for
// accept_invitation live in one signed, httpOnly, SameSite=Lax cookie for 10 minutes. Implemented by foundation-auth.
export type { OAuthState } from "./types";

export const OAUTH_STATE_COOKIE = "kairos_oauth";
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
