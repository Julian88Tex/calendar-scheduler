// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// OAuth types shared by the foundation callback routes and the intent handlers in other modules
// (calendars.handleConnectCallback, polls.handleVoterFreeBusyCallback, compare.handleCompareCallback; ARCHITECTURE
// section 10.4).

export type OAuthProviderId = "google" | "microsoft";

export const OAUTH_INTENTS = [
  "login",
  "signup",
  "connect_calendar",
  "poll_freebusy",
  "compare_calendar",
  "link_login_method",
  "accept_invitation",
] as const;
export type OAuthIntent = (typeof OAUTH_INTENTS)[number];

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  idToken: string | null;
};

/** Identity decoded from the id token (no signature check needed: it came from the token endpoint over TLS). */
export type OAuthProfile = {
  /** Google `sub`, Microsoft `oid` (or `sub`). */
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  /** Microsoft tenant id (`tid`); personal accounts use 9188040d-6c67-4c5b-b112-36a304b66dad. */
  tenantId?: string | null;
  /** Microsoft work or school account (AU-13 Teams default location). */
  isWorkAccount?: boolean;
};

/** What the start route stores in the 10-minute state cookie (besides the PKCE verifier). */
export type OAuthState = {
  intent: OAuthIntent;
  /** Same-site relative path to return to (safeNextPath). */
  returnTo: string | null;
  /** accept_invitation: the plaintext invitation token. */
  invitationToken?: string | null;
  /** poll_freebusy: the poll slug or id; connect_calendar: optional flags; compare_calendar: none. */
  data?: Record<string, string>;
};

/** Passed to intent handlers after a successful code exchange. */
export type OAuthCallbackContext = {
  request: Request;
  provider: OAuthProviderId;
  intent: OAuthIntent;
  tokens: OAuthTokens;
  profile: OAuthProfile;
  state: OAuthState;
  /** Same as state.returnTo, already validated. */
  returnTo: string | null;
  /** The signed-in user starting the flow (connect_calendar, link_login_method), or null. */
  userId: string | null;
};
