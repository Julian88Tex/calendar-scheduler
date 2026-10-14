// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email core types (ARCHITECTURE section 13.1). Type-only module: safe to import from anywhere.

export type EmailCategory = "transactional" | "workflow" | "poll" | "system" | "auth";

export type IcsMethod = "REQUEST" | "CANCEL" | "PUBLISH";

export type EmailMessage = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  /** Host email for invitee-facing meeting emails (NT-20); null omits the header. */
  replyTo?: string | null;
  /** Display name of the From header ("{Host name} via {AppName}" for invitee-facing meeting emails, NT-20). */
  fromName?: string | null;
  subject: string;
  html: string;
  text: string;
  ics?: { method: IcsMethod; content: string; filename?: string } | null;
  attachments?: { filename: string; contentType: string; content: Buffer | string }[];
  /** Template id for the outbox viewer, e.g. "lifecycle.invitee_confirmation". */
  template: string;
  category: EmailCategory;
  idempotencyKey: string;
  /** Adds List-Unsubscribe and List-Unsubscribe-Post: List-Unsubscribe=One-Click (GEN-08). */
  listUnsubscribe?: { url: string; mailto?: string } | null;
  related?: {
    organizationId?: string;
    userId?: string;
    scheduledEventId?: string;
    inviteeId?: string;
    pollId?: string;
    workflowExecutionId?: string;
  };
};

export type SendEmailResult = { id: string; status: "sent" | "stored" | "queued" | "failed"; deduplicated: boolean };

/**
 * Which transport delivers email: Resend, SMTP, the owner's Gmail (users.messages.send through their Google
 * connection, src/lib/email/gmail-transport.ts) or the database outbox (stored, not sent).
 */
export type EmailTransportName = "resend" | "smtp" | "gmail" | "outbox";

export type EmailBrand = {
  /** Absolute URL of the account logo (shown instead of the avatar when present). */
  logoUrl?: string | null;
  /** Absolute URL of the host avatar (round, top of the card). */
  avatarUrl?: string | null;
  /** Footer "Powered by {AppName}" (hidden when the owner turned branding off). */
  showPoweredBy: boolean;
  /** Button and link color (hex); defaults to #006BFF. */
  primaryColor?: string;
};

/** A rendered template: what every module email template function returns. */
export type RenderedEmail = { subject: string; html: string; text: string };
