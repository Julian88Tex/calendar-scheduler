// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// sendEmail and the outbox delivery state machine (SPEC GEN-15, NT-06, NT-20, ADM-04; ARCHITECTURE section 13.1).
//
// Every email is an email_outbox row first (idempotent by msg.idempotencyKey: the first write wins), then delivered
// synchronously:
//   no provider          -> status "stored", provider "outbox" (viewable in Admin > Outbox, GEN-15)
//   Resend or SMTP        -> "sending" -> "sent" (provider message id) | "failed" (+ email.retry job with backoff)
// Delivery of an existing row is claimed atomically (failed/queued -> sending), so concurrent retries never send twice;
// providers also receive a per-row idempotency key. A periodic email.retry sweep re-sends rows interrupted mid-delivery
// (serverless function killed). Permanent provider rejections are marked failed without retries.
import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { emailOutbox } from "@/db/schema";
import { appName } from "../brand";
import { AppError } from "../errors";
import { getEnv } from "../env";
import { enqueueJob } from "../jobs/queue";
import { log } from "../logger";
import { now, nowMs } from "../time/now";
import { absoluteUrl, appHost } from "../url";
import { formatAddress, isValidEmailAddress, normalizeRecipients, parseAddress, sanitizeHeaderValue } from "./address";
import { isAbsoluteHttpUrl } from "./html";
import { deliverWithResend, deliverWithSmtp, type DeliveryResult, type OutgoingEmail } from "./transports";
import type { EmailMessage, EmailTransportName, SendEmailResult } from "./types";

export type OutboxRow = typeof emailOutbox.$inferSelect;

/** Total delivery attempts per email (the inline one plus email.retry jobs), GEN-16. */
export const EMAIL_MAX_ATTEMPTS = 8;
/** A row left in "sending" longer than this was interrupted (function killed mid-delivery) and is re-sent. */
export const EMAIL_STALE_SENDING_MS = 10 * 60 * 1000;
const PERMANENT_PREFIX = "permanent: ";
const RETRY_BASE_MS = 30_000;

/** Which transport delivers email (GEN-15): Resend, else SMTP, else the database outbox. */
export function emailTransportName(): EmailTransportName {
  const e = getEnv();
  if (e.RESEND_API_KEY) return "resend";
  if (e.SMTP_HOST) return "smtp";
  return "outbox";
}

const warnedFrom = new Set<string>();

/** The sender mailbox: EMAIL_FROM (address and optional display name), else "{AppName}" <notifications@{APP_URL host}>. */
export function senderMailbox(): { name: string; address: string } {
  const configured = getEnv().EMAIL_FROM;
  const parsed = configured ? parseAddress(configured) : null;
  if (parsed) return { name: parsed.name ?? appName(), address: parsed.address };
  if (configured && !warnedFrom.has(configured)) {
    warnedFrom.add(configured);
    log.warn("email.invalid_email_from", { message: "EMAIL_FROM is not a valid address; using the default sender." });
  }
  const host = appHost().replace(/:\d+$/, "") || "localhost";
  return { name: appName(), address: `notifications@${host}` };
}

/** Default From header value: EMAIL_FROM, else "{AppName}" <notifications@{APP_URL host}>. */
export function defaultFromAddress(): string {
  const m = senderMailbox();
  return formatAddress(m.name, m.address);
}

/** List-Unsubscribe (RFC 2369) and one-click List-Unsubscribe-Post (RFC 8058) headers (GEN-08). */
export function listUnsubscribeHeaders(lu: EmailMessage["listUnsubscribe"]): Record<string, string> {
  if (!lu || !isAbsoluteHttpUrl(lu.url)) return {};
  const parts = [`<${sanitizeHeaderValue(lu.url, 900)}>`];
  if (lu.mailto) {
    const mailto = sanitizeHeaderValue(lu.mailto, 300).replace(/^mailto:/i, "");
    if (mailto) parts.push(`<mailto:${mailto}>`);
  }
  return { "List-Unsubscribe": parts.join(", "), "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

/** Headers every email carries (no auto replies to automated notifications, RFC 3834) plus the message's own. */
export function emailHeaders(msg: Pick<EmailMessage, "listUnsubscribe">): Record<string, string> {
  return {
    "Auto-Submitted": "auto-generated",
    "X-Auto-Response-Suppress": "OOF, AutoReply",
    ...listUnsubscribeHeaders(msg.listUnsubscribe),
  };
}

function toBase64(content: Buffer | string): string {
  return Buffer.isBuffer(content) ? content.toString("base64") : Buffer.from(content, "utf8").toString("base64");
}

function tagValue(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) || "none";
}

function outgoingFrom(row: OutboxRow, headers: Record<string, string>): OutgoingEmail {
  return {
    from: { name: row.fromName, address: row.fromAddress },
    to: row.toAddresses,
    cc: row.ccAddresses,
    bcc: row.bccAddresses,
    replyTo: row.replyTo,
    subject: row.subject,
    html: row.html,
    text: row.text,
    ics: row.ics ? { method: row.icsMethod ?? "REQUEST", content: row.ics, filename: "invite.ics" } : null,
    attachments: row.attachments,
    headers,
    idempotencyKey: `kairos-outbox-${row.id}`,
    tags: [
      { name: "category", value: tagValue(row.category) },
      { name: "template", value: tagValue(row.template) },
    ],
  };
}

async function deliverRow(row: OutboxRow, headers: Record<string, string>): Promise<DeliveryResult | "outbox"> {
  const transport = emailTransportName();
  if (transport === "outbox") return "outbox";
  const outgoing = outgoingFrom(row, headers);
  if (transport === "resend") return deliverWithResend(outgoing, getEnv().RESEND_API_KEY!);
  return deliverWithSmtp(outgoing);
}

function backoffMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(attempts - 1, 0), 6 * 60 * 60 * 1000);
}

type Outcome = "sent" | "stored" | "failed" | "retry";

/** Delivers a row already in "sending" (claimed by this caller) and records the outcome. */
async function finishDelivery(db: DbOrTx, row: OutboxRow, headers: Record<string, string>): Promise<Outcome> {
  const result = await deliverRow(row, headers);
  const at = now();
  if (result === "outbox") {
    await db
      .update(emailOutbox)
      .set({ status: "stored", provider: "outbox", sentAt: at, updatedAt: at, lastError: null })
      .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "sending")));
    log.info("email.stored", { id: row.id, template: row.template, outbox: absoluteUrl("/app/admin/outbox") });
    return "stored";
  }
  if (result.ok) {
    await db
      .update(emailOutbox)
      .set({ status: "sent", providerMessageId: result.providerMessageId, sentAt: at, updatedAt: at, lastError: null })
      .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "sending")));
    log.info("email.sent", { id: row.id, template: row.template, provider: emailTransportName() });
    return "sent";
  }
  const retry = result.retryable && row.attempts < EMAIL_MAX_ATTEMPTS;
  const lastError = (result.retryable ? result.error : `${PERMANENT_PREFIX}${result.error}`).slice(0, 2000);
  await db
    .update(emailOutbox)
    .set({ status: "failed", lastError, updatedAt: at, provider: emailTransportName() })
    .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "sending")));
  log.warn("email.failed", { id: row.id, template: row.template, attempt: row.attempts, retry, error: result.error });
  return retry ? "retry" : "failed";
}

async function scheduleRetry(db: DbOrTx, row: OutboxRow, headers: Record<string, string>): Promise<void> {
  await enqueueJob(db, {
    type: "email.retry",
    payload: { outboxId: row.id, headers },
    runAt: new Date(nowMs() + backoffMs(row.attempts)),
    idempotencyKey: `email.retry:${row.id}`,
    maxAttempts: Math.max(1, EMAIL_MAX_ATTEMPTS - row.attempts),
    priority: 5,
  });
}

/** Claims an existing row for delivery (failed or queued, or interrupted "sending"), counting the attempt. */
async function claimRow(db: DbOrTx, id: string, opts: { includeStale?: boolean } = {}): Promise<OutboxRow | null> {
  const at = now();
  const stale = new Date(at.getTime() - EMAIL_STALE_SENDING_MS);
  const statusCond = opts.includeStale
    ? or(inArray(emailOutbox.status, ["failed", "queued"]), and(eq(emailOutbox.status, "sending"), lt(emailOutbox.updatedAt, stale)))
    : inArray(emailOutbox.status, ["failed", "queued"]);
  const [row] = await db
    .update(emailOutbox)
    .set({ status: "sending", attempts: sql`${emailOutbox.attempts} + 1`, updatedAt: at })
    .where(and(eq(emailOutbox.id, id), statusCond, isNull(emailOutbox.bodyPurgedAt)))
    .returning();
  return row ?? null;
}

const isPermanent = (row: Pick<OutboxRow, "lastError">) => Boolean(row.lastError?.startsWith(PERMANENT_PREFIX));

function publicStatus(status: OutboxRow["status"]): SendEmailResult["status"] {
  return status === "sending" ? "queued" : status;
}

/**
 * Sends one email (see the file header). Idempotent by msg.idempotencyKey: a second call returns the first row
 * (deduplicated) and, when that row failed with a retryable error, tries it again right away.
 */
export async function sendEmail(msg: EmailMessage): Promise<SendEmailResult> {
  if (!msg.idempotencyKey?.trim()) throw new AppError("validation", "sendEmail: idempotencyKey is required");
  const db = await getDb();
  const transport = emailTransportName();
  const headers = emailHeaders(msg);
  const to = normalizeRecipients(msg.to);
  const cc = normalizeRecipients(msg.cc);
  const bcc = normalizeRecipients(msg.bcc);
  const sender = senderMailbox();
  const replyTo = msg.replyTo && isValidEmailAddress(parseAddress(msg.replyTo)?.address) ? sanitizeHeaderValue(msg.replyTo, 320) : null;
  if (msg.replyTo && !replyTo) log.warn("email.invalid_reply_to", { template: msg.template });
  const invalid = [...to.invalid, ...cc.invalid, ...bcc.invalid];
  const noRecipients = to.valid.length === 0;
  const at = now();
  const stored = transport === "outbox" && !noRecipients;

  const inserted = await db
    .insert(emailOutbox)
    .values({
      organizationId: msg.related?.organizationId ?? null,
      toAddresses: noRecipients ? to.invalid.slice(0, 10) : to.valid,
      ccAddresses: cc.valid,
      bccAddresses: bcc.valid,
      fromAddress: sender.address,
      fromName: msg.fromName?.trim() ? sanitizeHeaderValue(msg.fromName, 200) : sender.name,
      replyTo,
      subject: sanitizeHeaderValue(msg.subject || "(no subject)"),
      html: msg.html,
      text: msg.text,
      attachments: (msg.attachments ?? []).map((a) => ({
        filename: sanitizeHeaderValue(a.filename, 200) || "attachment",
        contentType: sanitizeHeaderValue(a.contentType, 200) || "application/octet-stream",
        contentBase64: toBase64(a.content),
      })),
      icsMethod: msg.ics?.method ?? null,
      ics: msg.ics?.content ?? null,
      template: msg.template,
      category: msg.category,
      status: noRecipients ? "failed" : stored ? "stored" : "sending",
      provider: transport,
      attempts: noRecipients || stored ? 0 : 1,
      lastError: noRecipients
        ? `${PERMANENT_PREFIX}no valid recipients`
        : invalid.length
          ? `Skipped invalid addresses: ${invalid.join(", ")}`.slice(0, 2000)
          : null,
      idempotencyKey: msg.idempotencyKey,
      relatedUserId: msg.related?.userId ?? null,
      scheduledEventId: msg.related?.scheduledEventId ?? null,
      inviteeId: msg.related?.inviteeId ?? null,
      pollId: msg.related?.pollId ?? null,
      workflowExecutionId: msg.related?.workflowExecutionId ?? null,
      createdAt: at,
      updatedAt: at,
      sentAt: stored ? at : null,
    })
    .onConflictDoNothing({ target: emailOutbox.idempotencyKey })
    .returning();

  const row = inserted[0];
  if (row) {
    if (noRecipients) {
      log.warn("email.no_recipients", { id: row.id, template: msg.template });
      return { id: row.id, status: "failed", deduplicated: false };
    }
    if (stored) {
      log.info("email.stored", { id: row.id, template: msg.template, outbox: absoluteUrl("/app/admin/outbox") });
      return { id: row.id, status: "stored", deduplicated: false };
    }
    const outcome = await finishDelivery(db, row, headers);
    if (outcome === "retry") await scheduleRetry(db, row, headers);
    return { id: row.id, status: outcome === "retry" ? "failed" : outcome, deduplicated: false };
  }

  const [existing] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, msg.idempotencyKey)).limit(1);
  if (!existing) throw new Error("sendEmail: outbox row vanished");
  if ((existing.status === "failed" || existing.status === "queued") && !isPermanent(existing) && existing.attempts < EMAIL_MAX_ATTEMPTS) {
    const claimed = await claimRow(db, existing.id);
    if (claimed) {
      const outcome = await finishDelivery(db, claimed, headers);
      if (outcome === "retry") await scheduleRetry(db, claimed, headers);
      return { id: claimed.id, status: outcome === "retry" ? "failed" : outcome, deduplicated: true };
    }
    const [fresh] = await db.select({ status: emailOutbox.status }).from(emailOutbox).where(eq(emailOutbox.id, existing.id));
    return { id: existing.id, status: publicStatus(fresh?.status ?? existing.status), deduplicated: true };
  }
  return { id: existing.id, status: publicStatus(existing.status), deduplicated: true };
}

export type RetryEmailOutcome = "sent" | "stored" | "failed" | "retry" | "skipped";

/**
 * Retries delivery of one outbox row (the email.retry job). "retry" means the attempt failed with a retryable error
 * (the job throws so the runner backs off); "skipped" means there was nothing to do (already sent, being sent,
 * permanently failed, or purged).
 */
export async function retryEmailDelivery(outboxId: string, headers: Record<string, string> = {}): Promise<RetryEmailOutcome> {
  const db = await getDb();
  const [current] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, outboxId)).limit(1);
  if (!current || isPermanent(current) || current.bodyPurgedAt) return "skipped";
  const claimed = await claimRow(db, outboxId, { includeStale: true });
  if (!claimed) return "skipped";
  const merged = { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "OOF, AutoReply", ...headers };
  return finishDelivery(db, claimed, merged);
}

/** Re-sends rows interrupted mid-delivery ("sending" or "queued" for more than 10 minutes). Returns how many were tried. */
export async function sweepStuckEmails(limit = 20): Promise<number> {
  const db = await getDb();
  const stale = new Date(nowMs() - EMAIL_STALE_SENDING_MS);
  const rows = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(and(inArray(emailOutbox.status, ["sending", "queued"]), lt(emailOutbox.updatedAt, stale), isNull(emailOutbox.bodyPurgedAt)))
    .orderBy(emailOutbox.updatedAt)
    .limit(limit);
  let tried = 0;
  for (const r of rows) {
    const outcome = await retryEmailDelivery(r.id);
    if (outcome === "skipped") continue;
    tried++;
    if (outcome === "retry") {
      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, r.id));
      if (row) await scheduleRetry(db, row, {});
    }
  }
  return tried;
}

/**
 * Sends a fresh copy of an outbox row (ADM-04 "Resend"): a new outbox row with a new idempotency key. Refuses rows
 * whose bodies were purged after 30 days ("Content removed after 30 days").
 */
export async function resendOutboxEmail(
  outboxId: string,
  opts: { idempotencyKey?: string; to?: string[] } = {},
): Promise<SendEmailResult> {
  const db = await getDb();
  const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, outboxId)).limit(1);
  if (!row) throw new AppError("not_found", "Email not found");
  if (row.bodyPurgedAt) throw new AppError("conflict", "Content removed after 30 days");
  return sendEmail({
    to: opts.to?.length ? opts.to : row.toAddresses,
    cc: opts.to?.length ? [] : row.ccAddresses,
    bcc: opts.to?.length ? [] : row.bccAddresses,
    replyTo: row.replyTo,
    fromName: row.fromName,
    subject: row.subject,
    html: row.html,
    text: row.text,
    ics: row.ics ? { method: (row.icsMethod ?? "REQUEST") as "REQUEST" | "CANCEL" | "PUBLISH", content: row.ics } : null,
    attachments: row.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: Buffer.from(a.contentBase64, "base64"),
    })),
    template: row.template,
    category: row.category as EmailMessage["category"],
    idempotencyKey: opts.idempotencyKey ?? `resend:${row.id}:${nowMs()}`,
    related: {
      organizationId: row.organizationId ?? undefined,
      userId: row.relatedUserId ?? undefined,
      scheduledEventId: row.scheduledEventId ?? undefined,
      inviteeId: row.inviteeId ?? undefined,
      pollId: row.pollId ?? undefined,
      workflowExecutionId: row.workflowExecutionId ?? undefined,
    },
  });
}
