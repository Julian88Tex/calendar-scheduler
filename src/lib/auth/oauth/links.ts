// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// OAuth start links (ARCHITECTURE section 10.4), client and server safe. Every module starts Google or Microsoft flows
// through these paths:
//
//   oauthStartPath("google", { intent: "login", next: "/app/meetings" })
//   oauthStartPath("google", { intent: "accept_invitation", invitation: token })          // teams-org /invite/{token}
//   oauthStartPath("microsoft", { intent: "connect_calendar", next: "/app/availability/calendar-settings" })
//   oauthStartPath("google", { intent: "poll_freebusy", next: `/p/${slug}`, data: { poll: slug } })
//   oauthStartPath("google", { intent: "link_login_method", confirm })   // confirm from verifyLoginMethodCode (AU-10)
//
// Query parameters of GET /api/auth/{provider}/start: intent (default login), next (same-site path), invitation
// (accept_invitation token), tz (browser IANA zone for new accounts), confirm (link_login_method: the confirmation
// token of the emailed 6-digit code) and any other short key/value pairs, which the callback hands to the intent
// handler as OAuthCallbackContext.state.data.
import type { OAuthIntent, OAuthProviderId } from "./types";

export type OAuthStartOptions = {
  intent?: OAuthIntent;
  next?: string | null;
  invitation?: string | null;
  /** Browser time zone (signup defaults, AU-13). */
  tz?: string | null;
  /** link_login_method: the token returned by verifyLoginMethodCode (src/lib/auth/flows/login-method-code.ts). */
  confirm?: string | null;
  /** Extra intent data (keys: letters, digits and underscores, up to 32 characters; values up to 512 characters). */
  data?: Record<string, string>;
};

/** Reserved start parameters (never part of `data`). */
export const OAUTH_START_RESERVED_PARAMS = ["intent", "next", "invitation", "tz", "confirm"] as const;

/** GET /api/auth/{provider}/start?... */
export function oauthStartPath(provider: OAuthProviderId, opts: OAuthStartOptions = {}): string {
  const q = new URLSearchParams();
  if (opts.intent && opts.intent !== "login") q.set("intent", opts.intent);
  if (opts.next) q.set("next", opts.next);
  if (opts.invitation) q.set("invitation", opts.invitation);
  if (opts.tz) q.set("tz", opts.tz);
  if (opts.confirm) q.set("confirm", opts.confirm);
  for (const [k, v] of Object.entries(opts.data ?? {})) {
    if (!(OAUTH_START_RESERVED_PARAMS as readonly string[]).includes(k)) q.set(k, v);
  }
  const qs = q.toString();
  return `/api/auth/${provider}/start${qs ? `?${qs}` : ""}`;
}

/** Display names used in buttons and messages. */
export const OAUTH_PROVIDER_NAMES: Record<OAuthProviderId, string> = { google: "Google", microsoft: "Microsoft" };
