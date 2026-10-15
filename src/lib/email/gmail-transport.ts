// OWNER: gmail (email sending from the owner's Gmail).
//
// The Gmail transport (owner decision: confirmation, reschedule, cancellation and reminder emails are sent from the
// owner's own Gmail): Gmail API users.messages.send with the owner's Google connection, the raw RFC 5322 message from
// gmail-mime.ts as base64url (`{ raw }`), or through the media upload endpoint for messages above 4 MB.
//
// Credentials come from the calendar connection helpers (src/lib/calendars/credentials.ts withConnection): the access
// token is refreshed when it expires within 5 minutes, under the per-connection lock, keeping the stored refresh token
// when Google returns none; a 401 refreshes once and retries.
//
// Outcomes (DeliveryResult):
//   200                                   -> ok with Gmail's message id
//   401 after the refresh, invalid_grant,  -> hold: the connection is marked needs_reauth (the dashboard's calendar
//   a missing gmail.send permission           connection banner and the connection problem email follow), and the
//                                            email waits in the outbox as failed with a clear reason until the owner
//                                            reconnects (src/lib/email/send.ts)
//   429, 5xx, 403 rate and daily limits,   -> retryable: the outbox schedules email.retry with backoff (Retry-After is
//   network errors, a disabled Gmail API      honored), and the job throws so the runner backs off
//   other 4xx (invalid recipients, too     -> permanent: failed without retries
//   large, mail service off for the account)
import "server-only";
import { withConnection } from "@/lib/calendars/credentials";
import { isProviderAuthError, isProviderTransientError, ProviderAuthError } from "@/lib/calendars/providers/types";
import { now } from "../time/now";
import { buildGmailMime, toBase64Url } from "./gmail-mime";
import { gmailFromName, reconnectHoldReason, type GmailSender } from "./gmail-sender";
import type { DeliveryResult, OutgoingEmail } from "./transports";

export const GMAIL_API_ORIGIN = "https://gmail.googleapis.com";
export const GMAIL_SEND_URL = `${GMAIL_API_ORIGIN}/gmail/v1/users/me/messages/send`;
export const GMAIL_UPLOAD_URL = `${GMAIL_API_ORIGIN}/upload/gmail/v1/users/me/messages/send?uploadType=media`;
const REQUEST_TIMEOUT_MS = 20_000;
/** Raw messages above this size go through the media upload endpoint. */
export const GMAIL_SIMPLE_MAX_BYTES = 4 * 1024 * 1024;
/** Gmail's limit for a message sent through the API, attachments included. */
export const GMAIL_MAX_BYTES = 35 * 1024 * 1024;
/** Longest Retry-After honored (the outbox caps its own backoff at 6 hours). */
const MAX_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "RATE_LIMIT_EXCEEDED"]);

/** A Gmail API failure that is not about credentials. */
export class GmailApiError extends Error {
  status: number | null;
  reason: string | null;
  retryable: boolean;
  retryAfterMs: number | null;
  constructor(message: string, p: { status?: number | null; reason?: string | null; retryable: boolean; retryAfterMs?: number | null }) {
    super(message);
    this.name = "GmailApiError";
    this.status = p.status ?? null;
    this.reason = p.reason ?? null;
    this.retryable = p.retryable;
    this.retryAfterMs = p.retryAfterMs ?? null;
  }
}

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: { reason?: string; message?: string }[];
    details?: { "@type"?: string; reason?: string }[];
  };
};

/** Retry-After in ms (delta seconds or an HTTP date), capped; null when absent or unreadable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Math.min(Number(v) * 1000, MAX_RETRY_AFTER_MS);
  const at = Date.parse(v);
  if (!Number.isFinite(at)) return null;
  return Math.min(Math.max(at - nowMs, 0), MAX_RETRY_AFTER_MS);
}

const API_DISABLED_MESSAGE =
  "The Gmail API is not enabled in this server's Google Cloud project. Enable it at https://console.cloud.google.com/apis/library/gmail.googleapis.com; the email is sent again automatically.";

/** Maps a non-2xx Gmail response to ProviderAuthError (credentials) or GmailApiError. */
export async function gmailErrorFromResponse(res: Response): Promise<Error> {
  let body: GoogleErrorBody = {};
  try {
    body = (await res.json()) as GoogleErrorBody;
  } catch {
    // non-JSON error body
  }
  const reasons = [
    ...(body.error?.errors ?? []).map((e) => e.reason),
    ...(body.error?.details ?? []).map((d) => d.reason),
    body.error?.status,
  ].filter((r): r is string => Boolean(r));
  const reason = reasons[0] ?? null;
  const has = (...names: string[]) => reasons.some((r) => names.includes(r));
  const message = (body.error?.message ?? `Gmail answered ${res.status}`).slice(0, 500);
  const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), now().getTime());
  const status = res.status;
  if (status === 401) return new ProviderAuthError(message, "unauthorized");
  if (status === 403 || status === 429) {
    if (status === 429 || has(...RATE_LIMIT_REASONS)) {
      return new GmailApiError(`gmail ${status}${reason ? ` ${reason}` : ""}: ${message}`, { status, reason, retryable: true, retryAfterMs });
    }
    if (has("insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT") || /insufficient authentication scopes/i.test(message)) {
      return new ProviderAuthError(message, "insufficient_scope");
    }
    if (has("accessNotConfigured", "SERVICE_DISABLED")) {
      return new GmailApiError(API_DISABLED_MESSAGE, { status, reason, retryable: true, retryAfterMs });
    }
    return new GmailApiError(`Gmail refused to send this email (${status}${reason ? ` ${reason}` : ""}): ${message}`, { status, reason, retryable: false });
  }
  if (status >= 500) {
    return new GmailApiError(`gmail ${status}${reason ? ` ${reason}` : ""}: ${message}`, { status, reason, retryable: true, retryAfterMs });
  }
  // 400 (invalid recipients or headers, mail service off for the account), 404, 413: this message never goes through.
  return new GmailApiError(`Gmail refused to send this email (${status}${reason ? ` ${reason}` : ""}): ${message}`, { status, reason, retryable: false });
}

/** POSTs the raw message with one access token; throws ProviderAuthError on 401 so withConnection refreshes. */
async function sendRaw(accessToken: string | undefined, raw: Buffer): Promise<{ id: string | null }> {
  if (!accessToken) throw new ProviderAuthError("No Google access token", "no_credentials");
  const upload = raw.length > GMAIL_SIMPLE_MAX_BYTES;
  let res: Response;
  try {
    res = await fetch(upload ? GMAIL_UPLOAD_URL : GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": upload ? "message/rfc822" : "application/json",
      },
      body: upload ? new Uint8Array(raw) : JSON.stringify({ raw: toBase64Url(raw) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new GmailApiError(`Could not reach Gmail: ${e instanceof Error ? e.message : String(e)}`, { retryable: true });
  }
  if (!res.ok) throw await gmailErrorFromResponse(res);
  let id: string | null = null;
  try {
    const data = (await res.json()) as { id?: unknown };
    id = typeof data.id === "string" && data.id ? data.id : null;
  } catch {
    // Accepted (2xx) without a readable body: sent, id unknown.
  }
  return { id };
}

/** The held-email reason for a credential failure. */
function credentialHoldReason(e: ProviderAuthError, address: string): string {
  if (e.reason === "insufficient_scope") {
    return `Your Google account ${address} no longer allows sending email. Reconnect it on Integrations > Google Calendar and allow "Send email on your behalf"; this email is sent automatically once you do.`;
  }
  return reconnectHoldReason(address);
}

export type GmailDeliveryOptions = {
  /** Message-ID header, stable per outbox row (`<kairos-outbox-{id}@{host}>`). */
  messageId: string;
};

/** Sends one email from the owner's Gmail (see the file header). Never throws. */
export async function deliverWithGmail(msg: OutgoingEmail, sender: GmailSender, opts: GmailDeliveryOptions): Promise<DeliveryResult> {
  let raw: Buffer;
  try {
    raw = await buildGmailMime({ msg, from: { name: gmailFromName(sender), address: sender.address }, messageId: opts.messageId, date: now() });
  } catch (e) {
    return { ok: false, retryable: false, error: `gmail: the message could not be built: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (raw.length > GMAIL_MAX_BYTES) {
    return { ok: false, retryable: false, error: `gmail: the message is ${Math.ceil(raw.length / 1024 / 1024)} MB; Gmail accepts up to 35 MB.` };
  }
  try {
    const { id } = await withConnection(sender.connectionId, (ctx) => sendRaw(ctx.accessToken, raw));
    return { ok: true, providerMessageId: id };
  } catch (e) {
    if (isProviderAuthError(e)) return { ok: false, retryable: false, hold: true, error: credentialHoldReason(e, sender.address) };
    if (e instanceof GmailApiError) {
      return { ok: false, retryable: e.retryable, error: e.message, ...(e.retryAfterMs !== null ? { retryAfterMs: e.retryAfterMs } : {}) };
    }
    if (isProviderTransientError(e)) return { ok: false, retryable: true, error: `gmail: ${e.message}` };
    return { ok: false, retryable: true, error: `gmail: ${e instanceof Error ? e.message : String(e)}`.slice(0, 2000) };
  }
}
