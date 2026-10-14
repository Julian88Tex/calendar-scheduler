// OWNER: gmail (email sending from the owner's Gmail).
//
// What the "Send emails from your Gmail" card on Integrations > Google Calendar renders (gmail-view.ts builds it,
// src/components/integrations/gmail-sending-card.tsx renders it). Types and pure copy helpers only: client and server
// safe.

/**
 * unavailable: Google sign in is not configured on this server; not_connected: no Google account connected;
 * permission_needed: connected, but no account allowed gmail.send; on: sending from `address`; off: the owner turned
 * it off (emails are stored, not sent); needs_reconnect: the sending account must be reconnected (emails wait);
 * other_provider: RESEND_API_KEY or SMTP_HOST sends instead; forced_outbox: EMAIL_PROVIDER=outbox.
 */
export type GmailSendingState =
  | "unavailable"
  | "not_connected"
  | "permission_needed"
  | "on"
  | "off"
  | "needs_reconnect"
  | "other_provider"
  | "forced_outbox";

export type GmailSendingCandidate = { id: string; address: string; status: "active" | "needs_reauth" | "error" };

export type GmailSendingView = {
  state: GmailSendingState;
  /** The address emails are (or would be) sent from. */
  address: string | null;
  /** The owner's Google accounts that allowed Gmail sending (a picker shows when there are several). */
  candidates: GmailSendingCandidate[];
  selectedConnectionId: string | null;
  /** The switch position: on unless the owner turned Gmail sending off. */
  enabled: boolean;
  /** EMAIL_PROVIDER when set (the switch is then read only). */
  envProvider: "gmail" | "resend" | "smtp" | "outbox" | null;
  /** The provider that sends instead of Gmail (RESEND_API_KEY or SMTP_HOST). */
  otherProvider: "resend" | "smtp" | null;
  /** The switch and the account picker can be changed here. */
  canEdit: boolean;
  /** Emails waiting for Gmail (sent automatically after a reconnect). */
  heldCount: number;
  /** The latest Gmail delivery failure of the last 7 days that was not a reconnect problem. */
  lastFailure: { message: string; at: string } | null;
  /** Google consent link that asks for "Send email on your behalf" (connect, or reconnect the sending account). */
  allowHref: string | null;
  /** Result of the consent round trip (?gmail=requested on return): whether gmail.send was granted. */
  requested: "granted" | "missing" | null;
};

/** The heading badge of the card. */
export function gmailStateBadge(state: GmailSendingState): { label: string; variant: "success" | "danger" | "neutral" | "warning" } {
  switch (state) {
    case "on":
      return { label: "On", variant: "success" };
    case "needs_reconnect":
      return { label: "Action required", variant: "danger" };
    case "off":
      return { label: "Off", variant: "neutral" };
    case "permission_needed":
      return { label: "Not allowed yet", variant: "warning" };
    default:
      return { label: "Not in use", variant: "neutral" };
  }
}

/** "1 email is waiting to be sent." / "{n} emails are waiting to be sent." */
export function heldEmailsLabel(n: number): string {
  return n === 1 ? "1 email is waiting to be sent." : `${n} emails are waiting to be sent.`;
}

/** The provider name of EMAIL_PROVIDER, RESEND_API_KEY or SMTP_HOST in copy. */
export function providerLabel(p: "gmail" | "resend" | "smtp" | "outbox"): string {
  return p === "gmail" ? "Gmail" : p === "resend" ? "Resend" : p === "smtp" ? "SMTP" : "the outbox";
}
