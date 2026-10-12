// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// OAuth intent dispatch (ARCHITECTURE section 10.4): login, signup and link_login_method (foundation-auth, always
// followed by calendars.linkCalendarFromOAuth), accept_invitation (teams.getPendingInvitation, email match rule,
// createUserAccount plus teams.acceptInvitationInTx, no signup policy check), connect_calendar
// (calendars.handleConnectCallback) and poll_freebusy (polls.handleVoterFreeBusyCallback).
// Foundation stub: every intent answers "not configured" until foundation-auth implements the flows.
import "server-only";
import { json } from "@/lib/http";
import type { OAuthCallbackContext, OAuthIntent } from "./types";

export { OAUTH_INTENTS, type OAuthIntent } from "./types";

export function isOAuthIntent(value: unknown): value is OAuthIntent {
  return (
    value === "login" ||
    value === "signup" ||
    value === "connect_calendar" ||
    value === "poll_freebusy" ||
    value === "link_login_method" ||
    value === "accept_invitation"
  );
}

/** Runs the intent of a completed OAuth callback and returns the response (usually a redirect). */
export async function dispatchOAuthIntent(ctx: OAuthCallbackContext): Promise<Response> {
  return json(
    { error: "not_configured", message: `Sign in with ${ctx.provider === "google" ? "Google" : "Microsoft"} is not available yet.` },
    { status: 501 },
  );
}
