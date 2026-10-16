// OWNER: golden-path-qa.
//
// How an email_outbox row reads on the email outbox page (pure; the page and its tests share it):
// - "sent": delivered by a provider; "stored": kept in the outbox because no email provider sends (nothing went out);
//   "queued": waiting for its first delivery or being delivered right now ("sending" rows count as queued);
// - "waiting_gmail": a failed row whose reason starts with GMAIL_HOLD_PREFIX: the owner's Google connection needs a
//   reconnect, and the email goes out by itself once it is reconnected (no resend needed, none offered);
// - "failed": anything else that failed. `retrying` when the failure is temporary and attempts are left (the email.retry
//   job tries again), otherwise it failed for good and can be resent as a new copy.
// Internal prefixes never reach the screen: the hold prefix becomes the "Waiting for Gmail" label and "permanent: "
// is dropped from the reason.
import { EMAIL_MAX_ATTEMPTS, GMAIL_HOLD_PREFIX } from "@/lib/email";

export const PERMANENT_PREFIX = "permanent: ";

export type OutboxStatusKind = "sent" | "stored" | "queued" | "waiting_gmail" | "failed";

export type OutboxStatusFilter = "all" | OutboxStatusKind;

export const OUTBOX_STATUS_FILTERS: readonly { value: OutboxStatusFilter; label: string }[] = [
  { value: "all", label: "All emails" },
  { value: "sent", label: "Sent" },
  { value: "stored", label: "Stored in the outbox" },
  { value: "queued", label: "Queued" },
  { value: "waiting_gmail", label: "Waiting for Gmail" },
  { value: "failed", label: "Failed" },
];

export const OUTBOX_STATUS_LABELS: Record<OutboxStatusKind, string> = {
  sent: "Sent",
  stored: "Stored",
  queued: "Queued",
  waiting_gmail: "Waiting for Gmail",
  failed: "Failed",
};

export type OutboxRowStatus = {
  kind: OutboxStatusKind;
  label: string;
  /** The reason shown under the status (failures and holds), without internal prefixes. */
  reason: string | null;
  /** A temporary failure the email.retry job tries again (attempts left). */
  retrying: boolean;
  /** "Resend" is offered: a failed row that is not waiting for Gmail and is not retrying by itself. */
  canResend: boolean;
};

type RowLike = { status: string; lastError: string | null; attempts: number; bodyPurgedAt?: Date | string | null };

/** The reason without the internal "permanent: " and "Waiting for Gmail: " prefixes (null when empty). */
export function cleanReason(lastError: string | null | undefined): string | null {
  let s = (lastError ?? "").trim();
  for (let i = 0; i < 3; i++) {
    if (s.startsWith(PERMANENT_PREFIX)) s = s.slice(PERMANENT_PREFIX.length).trim();
    else if (s.startsWith(GMAIL_HOLD_PREFIX)) s = s.slice(GMAIL_HOLD_PREFIX.length).trim();
    else break;
  }
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

export function isGmailHold(row: Pick<RowLike, "status" | "lastError">): boolean {
  return row.status === "failed" && Boolean(row.lastError?.startsWith(GMAIL_HOLD_PREFIX));
}

export function outboxRowStatus(row: RowLike): OutboxRowStatus {
  if (row.status === "sent" || row.status === "stored") {
    const kind = row.status;
    // A stored or sent row can still carry a note (for example skipped invalid addresses).
    return { kind, label: OUTBOX_STATUS_LABELS[kind], reason: cleanReason(row.lastError), retrying: false, canResend: false };
  }
  if (row.status === "queued" || row.status === "sending") {
    return { kind: "queued", label: OUTBOX_STATUS_LABELS.queued, reason: null, retrying: false, canResend: false };
  }
  if (isGmailHold(row)) {
    return { kind: "waiting_gmail", label: OUTBOX_STATUS_LABELS.waiting_gmail, reason: cleanReason(row.lastError), retrying: false, canResend: false };
  }
  const permanent = Boolean(row.lastError?.startsWith(PERMANENT_PREFIX));
  const retrying = !permanent && row.attempts < EMAIL_MAX_ATTEMPTS;
  const purged = Boolean(row.bodyPurgedAt);
  return {
    kind: "failed",
    label: OUTBOX_STATUS_LABELS.failed,
    reason: cleanReason(row.lastError),
    retrying,
    canResend: !retrying && !purged,
  };
}

/** "Gmail", "Resend", "SMTP", "Outbox" ("None" before the first delivery). */
export function providerLabel(provider: string | null | undefined): string {
  switch (provider) {
    case "gmail":
      return "Gmail";
    case "resend":
      return "Resend";
    case "smtp":
      return "SMTP";
    case "outbox":
      return "Outbox";
    default:
      return "None";
  }
}

export function parseStatusFilter(value: unknown): OutboxStatusFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return OUTBOX_STATUS_FILTERS.some((f) => f.value === v) ? (v as OutboxStatusFilter) : "all";
}
