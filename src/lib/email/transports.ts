// Email transports (SPEC GEN-15, NT-06; ARCHITECTURE section 13.1, tech-reference 10.1 and 10.2).
//
// - Resend (RESEND_API_KEY): REST through the official SDK, the ICS as an `invite.ics` attachment with
//   `text/calendar; charset=utf-8; method=...` (Resend cannot add a text/calendar alternative part), the Resend
//   Idempotency-Key header so a retried request never sends twice.
// - SMTP (SMTP_HOST): nodemailer without pooling (serverless friendly), the ICS as a `text/calendar; method=...`
//   alternative part plus an attachment (nodemailer `icalEvent`), which is what Gmail and Outlook need for native
//   invitation cards.
// Each call returns { ok } or a classified failure: retryable (network, rate limits, 5xx, auth or sender
// configuration that an admin can fix) or permanent (the provider rejected the message itself).
import "server-only";
import { getEnv } from "../env";
import { formatAddress } from "./address";

export type OutgoingEmail = {
  from: { name: string | null; address: string };
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  ics: { method: string; content: string; filename: string } | null;
  attachments: { filename: string; contentType: string; contentBase64: string }[];
  headers: Record<string, string>;
  /** Provider idempotency key (stable per outbox row). */
  idempotencyKey: string;
  tags: { name: string; value: string }[];
};

export type DeliveryResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: boolean; error: string };

const RESEND_TIMEOUT_MS = 15_000;

// Errors that will not go away by retrying the same message (the message itself is invalid).
const RESEND_PERMANENT = new Set([
  "validation_error",
  "missing_required_field",
  "invalid_parameter",
  "invalid_attachment",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "method_not_allowed",
  "not_found",
]);

/** Sends through Resend. */
export async function deliverWithResend(msg: OutgoingEmail, apiKey: string): Promise<DeliveryResult> {
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const attachments = [
    ...(msg.ics
      ? [
          {
            filename: msg.ics.filename,
            content: Buffer.from(msg.ics.content, "utf8").toString("base64"),
            contentType: `text/calendar; charset=utf-8; method=${msg.ics.method}`,
          },
        ]
      : []),
    ...msg.attachments.map((a) => ({ filename: a.filename, content: a.contentBase64, contentType: a.contentType })),
  ];
  try {
    const res = await resend.emails.send(
      {
        from: formatAddress(msg.from.name, msg.from.address),
        to: msg.to,
        ...(msg.cc.length ? { cc: msg.cc } : {}),
        ...(msg.bcc.length ? { bcc: msg.bcc } : {}),
        ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(Object.keys(msg.headers).length ? { headers: msg.headers } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(msg.tags.length ? { tags: msg.tags } : {}),
      },
      { idempotencyKey: msg.idempotencyKey, signal: AbortSignal.timeout(RESEND_TIMEOUT_MS) } as never,
    );
    if (res.error) {
      const status = res.error.statusCode ?? 0;
      const retryable = !RESEND_PERMANENT.has(res.error.name) || status === 429 || status >= 500;
      return { ok: false, retryable, error: `resend ${res.error.name}${status ? ` (${status})` : ""}: ${res.error.message}` };
    }
    return { ok: true, providerMessageId: res.data?.id ?? null };
  } catch (e) {
    return { ok: false, retryable: true, error: `resend: ${e instanceof Error ? e.message : String(e)}` };
  }
}

type SmtpTransport = { sendMail: (options: Record<string, unknown>) => Promise<{ messageId?: string }> };
const g = globalThis as typeof globalThis & { __kairosSmtp?: { key: string; transport: SmtpTransport } };

async function smtpTransport(): Promise<SmtpTransport> {
  const e = getEnv();
  const port = e.SMTP_PORT ?? 587;
  const secure = e.SMTP_SECURE ?? port === 465;
  const key = JSON.stringify([e.SMTP_HOST, port, secure, e.SMTP_USER ?? "", e.SMTP_PASS ?? ""]);
  if (g.__kairosSmtp?.key === key) return g.__kairosSmtp.transport;
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port,
    secure,
    ...(e.SMTP_USER ? { auth: { user: e.SMTP_USER, pass: e.SMTP_PASS ?? "" } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  }) as unknown as SmtpTransport;
  g.__kairosSmtp = { key, transport };
  return transport;
}

/** Forgets the cached SMTP transport (tests, configuration changes). */
export function resetSmtpTransport(): void {
  g.__kairosSmtp = undefined;
}

/** Sends through SMTP (nodemailer). */
export async function deliverWithSmtp(msg: OutgoingEmail): Promise<DeliveryResult> {
  try {
    const transport = await smtpTransport();
    const info = await transport.sendMail({
      from: { name: msg.from.name ?? "", address: msg.from.address },
      to: msg.to,
      ...(msg.cc.length ? { cc: msg.cc } : {}),
      ...(msg.bcc.length ? { bcc: msg.bcc } : {}),
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      headers: msg.headers,
      ...(msg.ics ? { icalEvent: { method: msg.ics.method, filename: msg.ics.filename, content: msg.ics.content } } : {}),
      ...(msg.attachments.length
        ? {
            attachments: msg.attachments.map((a) => ({
              filename: a.filename,
              content: a.contentBase64,
              encoding: "base64",
              contentType: a.contentType,
            })),
          }
        : {}),
    });
    return { ok: true, providerMessageId: info.messageId ?? null };
  } catch (e) {
    const err = e as { responseCode?: number; code?: string; message?: string };
    const code = err.responseCode ?? 0;
    // 550-554: mailbox unavailable, name not allowed, transaction failed: the message will never be accepted.
    const permanent = code >= 550 && code <= 554;
    return {
      ok: false,
      retryable: !permanent,
      error: `smtp${code ? ` ${code}` : ""}${err.code ? ` ${err.code}` : ""}: ${err.message ?? String(e)}`.slice(0, 2000),
    };
  }
}
