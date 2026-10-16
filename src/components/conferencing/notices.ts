// OWNER: conferencing.
//
// Messages for the query parameters the Google Calendar connect flow returns to the Google Meet page with
// (src/lib/calendars/oauth-connect.ts: ?connected=google, ?reconnect_mismatch=1, ?calendar_error=...; the foundation
// OAuth callback: ?oauth_error=...). The same wording as Integrations > Google Calendar. Pure, client and server safe.
import { isOAuthErrorCode } from "@/lib/auth/oauth/errors";

export type MeetNotice = { tone: "success" | "error" | "warning"; message: string };

/** Query parameters the notices come from (removed from the address bar once shown). */
export const MEET_NOTICE_PARAMS = ["connected", "calendar_error", "oauth_error", "provider", "reconnect_mismatch"] as const;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function meetConnectNotices(sp: Record<string, string | string[] | undefined>, appName: string): MeetNotice[] {
  const out: MeetNotice[] = [];
  if (first(sp.connected) === "google") {
    out.push({ tone: "success", message: "Google Calendar connected" });
    if (first(sp.reconnect_mismatch) === "1") {
      out.push({
        tone: "warning",
        message: "You connected a different Google account than the one that needs attention. To fix that connection, choose Reconnect and sign in with its own account.",
      });
    }
  }
  switch (first(sp.calendar_error)) {
    case "permissions":
      out.push({
        tone: "error",
        message: `${appName} needs permission to see and edit events on your Google Calendar. Connect again and keep both calendar permissions checked on Google's consent screen.`,
      });
      break;
    case "limit":
      out.push({ tone: "error", message: "You can connect up to 20 calendar accounts. Disconnect one to add another." });
      break;
    case "unsupported":
      out.push({ tone: "error", message: "This calendar provider isn't available on this server." });
      break;
    case "failed":
      out.push({ tone: "error", message: "We couldn't connect your calendar. Please try again." });
      break;
    default:
      break;
  }
  const oauth = first(sp.oauth_error);
  if (isOAuthErrorCode(oauth)) {
    const message =
      oauth === "canceled"
        ? "Connecting Google Calendar was canceled."
        : oauth === "not_configured"
          ? "Google Calendar is not configured on this server."
          : oauth === "expired"
            ? "Your connection attempt expired. Please try again."
            : oauth === "sign_in_required"
              ? "Log in to connect your calendar."
              : "We couldn't connect your calendar. Please try again.";
    out.push({ tone: oauth === "canceled" ? "warning" : "error", message });
  }
  return out;
}
