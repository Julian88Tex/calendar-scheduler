// OWNER: gmail (email sending from the owner's Gmail).
//
// Google OAuth scopes the Gmail email transport needs (docs/GOOGLE_SETUP.md, src/lib/email/gmail-transport.ts). Pure
// constants and helpers: client and server safe.
//
// gmail.send ("Send email on your behalf") is requested together with the calendar scopes whenever Google is connected
// (src/lib/auth/oauth/google.ts, incremental authorization with include_granted_scopes), so one consent covers
// conflict checking, events, Meet links and sending booking emails from the owner's own address. It lets the app send
// messages only: it cannot read, list or delete mail. Google classifies it as a sensitive (not restricted) scope.

/** users.messages.send only (no read access to the mailbox). */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** What Google's consent screen calls the gmail.send permission (shown on the Integrations page). */
export const GMAIL_SEND_PERMISSION_LABEL = "Send email on your behalf";

/** True when a grant (calendar_connections.scopes or a token response) includes gmail.send. */
export function hasGmailSendScope(scopes: readonly string[] | null | undefined): boolean {
  return Boolean(scopes?.includes(GMAIL_SEND_SCOPE));
}
