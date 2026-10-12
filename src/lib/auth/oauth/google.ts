// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Google OAuth (SPEC AU-02): scopes and authorize parameters. Code exchange, refresh, revoke and id token decoding are
// implemented by foundation-auth (tech-reference 5.1).

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

/** Extra authorize parameters (refresh token on every consent, incremental auth). */
export const GOOGLE_AUTHORIZE_PARAMS: Readonly<Record<string, string>> = {
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: "true",
};
