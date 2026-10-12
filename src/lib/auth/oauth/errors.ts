// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// OAuth error codes (SPEC AU-02, AU-03, AU-11, TM-03), client and server safe. The callback never puts user-facing text
// in a URL: it redirects with ?error={code}&provider={google|microsoft} (login, signup, /invite/{token}) or
// ?oauth_error={code}&provider=... (connect_calendar, link_login_method and poll_freebusy return paths), and each page
// renders the message with oauthErrorMessage(). /invite/{token} (teams-org) passes the invited email for
// "invitation_email_mismatch".
import { appName } from "@/lib/brand";
import type { OAuthProviderId } from "./types";

export const OAUTH_ERROR_CODES = [
  "canceled",
  "not_configured",
  "failed",
  "expired",
  "email_unverified",
  "no_email",
  "signups_closed",
  "account_linked_elsewhere",
  "invitation_invalid",
  "invitation_email_mismatch",
  "invitation_conflict",
  "sign_in_required",
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export function isOAuthErrorCode(value: unknown): value is OAuthErrorCode {
  return typeof value === "string" && (OAUTH_ERROR_CODES as readonly string[]).includes(value);
}

const NAMES: Record<OAuthProviderId, string> = { google: "Google", microsoft: "Microsoft" };

/** The user-facing message for an OAuth error code. */
export function oauthErrorMessage(
  code: OAuthErrorCode,
  p: { provider?: OAuthProviderId | null; invitedEmail?: string | null } = {},
): string {
  const name = p.provider ? NAMES[p.provider] : "Google or Microsoft";
  switch (code) {
    case "canceled":
      return `${name} sign in was canceled.`;
    case "not_configured":
      return `Sign in with ${name} is not configured on this server.`;
    case "expired":
      return "Your sign in attempt expired. Please try again.";
    case "email_unverified":
      return `Your ${name} email isn't verified.`;
    case "no_email":
      return `Your ${name} account did not share an email address.`;
    case "signups_closed":
      return "Sign ups are closed. Ask an admin for an invitation.";
    case "account_linked_elsewhere":
      return `This ${name} account is already connected to a different ${appName()} account.`;
    case "invitation_invalid":
      return "This invitation is no longer valid.";
    case "invitation_email_mismatch":
      return p.invitedEmail
        ? `Use ${p.invitedEmail} to accept this invitation.`
        : "Use the email address the invitation was sent to.";
    case "invitation_conflict":
      return "You already belong to another workspace.";
    case "sign_in_required":
      return "Log in to continue.";
    case "failed":
    default:
      return `We couldn't sign you in with ${name}. Please try again.`;
  }
}

/** Reads ?error= (or ?oauth_error=) and ?provider= from page search params; null when absent or unknown. */
export function oauthErrorFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
  key: "error" | "oauth_error" = "error",
): { code: OAuthErrorCode; provider: OAuthProviderId | null } | null {
  const raw = sp[key];
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (!isOAuthErrorCode(code)) return null;
  const p = Array.isArray(sp.provider) ? sp.provider[0] : sp.provider;
  return { code, provider: p === "google" || p === "microsoft" ? p : null };
}
