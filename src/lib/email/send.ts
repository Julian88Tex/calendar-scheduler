// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// sendEmail and the outbox delivery state machine (SPEC GEN-15, NT-06, NT-20, ADM-04; ARCHITECTURE section 13.1).
//
// Every email is an email_outbox row first (idempotent by msg.idempotencyKey: the first write wins), then delivered
// synchronously through the transport resolveEmailTransport() picks (gmail-sender.ts: EMAIL_PROVIDER, then Resend,
// then SMTP, then the owner's Gmail, else the outbox):
//   no provider          -> status "stored", provider "outbox" (viewable on the email outbox page, GEN-15)
//   Resend, SMTP, Gmail  -> "sending" -> "sent" (provider message id) | "failed" (+ email.retry job with backoff)
// Delivery of an existing row is claimed atomically (failed/queued -> sending), so concurrent retries never send twice;
// providers also receive a per-row idempotency key (Resend) or a per-row Message-ID (Gmail). A periodic email.retry
// sweep re-sends rows interrupted mid-delivery (serverless function killed) and failed rows whose retry job was lost.
// Permanent provider rejections are marked failed without retries. Each row gets at most EMAIL_MAX_ATTEMPTS delivery
// attempts in total.
//
// Held emails (Gmail): when the owner's Google connection needs a reconnect (revoked or expired token, gmail.send
// missing) the email is kept as "failed" with a reason starting with GMAIL_HOLD_PREFIX, the connection shows "Action
// required" with the dashboard's calendar connection banner, and no attempt is spent while Gmail cannot send (an
// earlier retryable failure is held as well). Its email.retry job (which carries the delivery headers) waits until the
// hold window ends. Once Gmail can send again (the owner reconnected, or another transport was configured) the sweep,
// or a visit to Integrations > Google Calendar, makes those jobs due and the emails go out, except emails that are no
// longer useful: older than 24 hours, about a meeting that already started, confirmations, updates and reminders of a
// meeting canceled meanwhile (its cancellation still goes out), time sensitive codes and links older than 10 minutes,
// and system notices. Those are marked failed for good with the reason. A retryable failure after the release is
// retried with backoff (the hold job is brought forward).
import "server-only";
import { and, count, eq, gt, inArray, isNull, like, lt, notLike, or, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { emailOutbox, jobs, scheduledEvents } from "@/db/schema";
import { appName } from "../brand";
import { AppError } from "../errors";
import { getEnv } from "../env";
import { enqueueOrReviveJob } from "../jobs/queue";
import { log } from "../logger";
import { now, nowMs } from "../time/now";
import { absoluteUrl, appHost } from "../url";
import { formatAddress, isValidEmailAddress, normalizeRecipients, parseAddress, sanitizeHeaderValue } from "./address";
import { configuredTransport, gmailFromName, NOT_CONNECTED_HOLD_REASON, resolveEmailTransport, type EmailTransportResolution } from "./gmail-sender";
import { isReservedHeader } from "./gmail-mime";
import { isAbsoluteHttpUrl } from "./html";
import { deliverWithResend, deliverWithSmtp, type DeliveryResult, type OutgoingEmail } from "./transports";
import type { EmailMessage, EmailTransportName, IcsMethod, SendEmailResult } from "./types";

export type OutboxRow = typeof emailOutbox.$inferSelect;

/** Total delivery attempts per email (the inline one plus email.retry jobs), GEN-16. */
export const EMAIL_MAX_ATTEMPTS = 8;
/** A row left in "sending" longer than this was interrupted (function killed mid-delivery) and is re-sent. */
export const EMAIL_STALE_SENDING_MS = 10 * 60 * 1000;
/** The owner's email outbox page (golden-path-qa), where stored and failed emails are listed. */
export const EMAIL_OUTBOX_PATH = "/app/settings/email-outbox";
/** last_error prefix of emails waiting for Gmail (the owner's Google connection needs a reconnect). */
export const GMAIL_HOLD_PREFIX = "Waiting for Gmail: ";
/** Held emails are sent after a reconnect only within this window; older ones are given up. */
export const GMAIL_HOLD_MAX_MS = 24 * 60 * 60 * 1000;
/** Codes, sign-in and verification links: sent after a reconnect only when held for less than this. */
export const GMAIL_HOLD_TIME_SENSITIVE_MS = 10 * 60 * 1000;
const PERMANENT_PREFIX = "permanent: ";
const RETRY_BASE_MS = 30_000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

/**
 * Content that expires within minutes (released only within GMAIL_HOLD_TIME_SENSITIVE_MS): sign in, password and
 * verification emails, and every verification code (booking.verification_code and polls.verification_code last 10
 * minutes).
 */
function isTimeSensitive(row: Pick<OutboxRow, "category" | "template">): boolean {
  return row.category === "auth" || row.template === "verification_code" || row.template.endsWith(".verification_code");
}

/**
 * True when the email is about the meeting's cancellation (or asks the invitee to book again), so it still matters once
 * the meeting is canceled: cancellation templates, request reschedule, and anything carrying a CANCEL invitation.
 */
function isAboutCancellation(row: Pick<OutboxRow, "template" | "icsMethod">): boolean {
  return row.icsMethod === "CANCEL" || /cancel|request_reschedule/i.test(row.template);
}

/**
 * Which transport the environment selects (GEN-15): EMAIL_PROVIDER when usable, else Resend, else SMTP, else the
 * database outbox. Synchronous, so it cannot see the owner's Gmail connection: sendEmail uses resolveEmailTransport()
 * (gmail-sender.ts), which also returns "gmail" when the owner connected Google with Gmail sending allowed.
 */
export function emailTransportName(): EmailTransportName {
  return configuredTransport()?.name ?? "outbox";
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

/** The Message-ID of an outbox row's Gmail deliveries: the same on every attempt, so a re-sent copy is one message. */
export function outboxMessageId(outboxId: string): string {
  const host = appHost().replace(/:\d+$/, "") || "localhost";
  return `<kairos-outbox-${outboxId}@${host}>`;
}

/** True when the row waits for Gmail (the owner's Google connection needs a reconnect). */
export function isHeldForGmail(row: Pick<OutboxRow, "status" | "lastError">): boolean {
  return row.status === "failed" && Boolean(row.lastError?.startsWith(GMAIL_HOLD_PREFIX));
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

type Delivery = {
  result: DeliveryResult | "outbox";
  transport: EmailTransportName;
  /** The mailbox the message was sent as, when the transport chose it (Gmail: the owner's name and address). */
  from: { name: string | null; address: string } | null;
};

async function deliverRow(row: OutboxRow, headers: Record<string, string>, resolution: EmailTransportResolution): Promise<Delivery> {
  const transport = resolution.name;
  if (transport === "outbox") return { result: "outbox", transport, from: null };
  if (transport === "gmail") {
    const sender = resolution.gmail;
    if (resolution.hold || !sender) {
      return { result: { ok: false, retryable: false, hold: true, error: resolution.hold ?? NOT_CONNECTED_HOLD_REASON }, transport, from: null };
    }
    // Loaded on demand: the Gmail transport uses the calendar connection helpers, which send email themselves.
    const { deliverWithGmail } = await import("./gmail-transport");
    const result = await deliverWithGmail(outgoingFrom(row, headers), sender, { messageId: outboxMessageId(row.id) });
    return { result, transport, from: { name: gmailFromName(sender), address: sender.address } };
  }
  const outgoing = outgoingFrom(row, headers);
  if (transport === "resend") return { result: await deliverWithResend(outgoing, getEnv().RESEND_API_KEY!), transport, from: null };
  return { result: await deliverWithSmtp(outgoing), transport, from: null };
}

function backoffMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(attempts - 1, 0), MAX_RETRY_DELAY_MS);
}

type Outcome = "sent" | "stored" | "failed" | "retry" | "held";
type Finished = { outcome: Outcome; retryAfterMs: number | null };

const outboxLink = () => absoluteUrl(EMAIL_OUTBOX_PATH);

/** Delivers a row already in "sending" (claimed by this caller) and records the outcome. */
async function finishDelivery(db: DbOrTx, row: OutboxRow, headers: Record<string, string>, resolution: EmailTransportResolution): Promise<Finished> {
  const { result, transport, from } = await deliverRow(row, headers, resolution);
  const at = now();
  if (result === "outbox") {
    await db
      .update(emailOutbox)
      .set({ status: "stored", provider: "outbox", sentAt: at, updatedAt: at, lastError: null })
      .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "sending")));
    log.info("email.stored", { id: row.id, template: row.template, outbox: outboxLink() });
    return { outcome: "stored", retryAfterMs: null };
  }
  if (result.ok) {
    await db
      .update(emailOutbox)
      .set({
        status: "sent",
        provider: transport,
        providerMessageId: result.providerMessageId ?? row.providerMessageId,
        ...(from ? { fromAddress: from.address, fromName: from.name } : {}),
        sentAt: row.sentAt ?? at,
        updatedAt: at,
        lastError: null,
      })
      .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "sending")));
    if (result.alreadySent) log.warn("email.already_sent", { id: row.id, template: row.template, provider: transport });
    else log.info("email.sent", { id: row.id, template: row.template, provider: transport });
    return { outcome: "sent", retryAfterMs: null };
  }
  if (result.hold) {
    const expired = at.getTime() - row.createdAt.getTime() > GMAIL_HOLD_MAX_MS;
    const lastError = expired
      ? `${PERMANENT_PREFIX}Not sent: Gmail could not send it within 24 hours. ${result.error}`
      : `${GMAIL_HOLD_PREFIX}${result.error}`;
    await db
      .update(emailOutbox)
      .set({ status: "failed", lastError: lastError.slice(0, 2000), updatedAt: at, provider: transport })
      .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "sending")));
    log.warn(expired ? "email.hold_expired" : "email.held", { id: row.id, template: row.template, error: result.error, outbox: outboxLink() });
    return { outcome: expired ? "failed" : "held", retryAfterMs: null };
  }
  const retry = result.retryable && row.attempts < EMAIL_MAX_ATTEMPTS;
  const lastError = (result.retryable ? result.error : `${PERMANENT_PREFIX}${result.error}`).slice(0, 2000);
  await db
    .update(emailOutbox)
    .set({ status: "failed", lastError, updatedAt: at, provider: transport })
    .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "sending")));
  log.warn("email.failed", { id: row.id, template: row.template, attempt: row.attempts, retry, provider: transport, error: result.error });
  return { outcome: retry ? "retry" : "failed", retryAfterMs: result.retryAfterMs ?? null };
}

async function scheduleRetry(db: DbOrTx, row: OutboxRow, headers: Record<string, string>, retryAfterMs: number | null = null): Promise<void> {
  // One retry job per row: revived when an earlier one already finished, so a later failure always gets its retry.
  const delay = Math.min(Math.max(backoffMs(row.attempts), retryAfterMs ?? 0), MAX_RETRY_DELAY_MS);
  const runAt = new Date(nowMs() + delay);
  const remaining = Math.max(1, EMAIL_MAX_ATTEMPTS - row.attempts);
  const id = await enqueueOrReviveJob(db, {
    type: "email.retry",
    payload: { outboxId: row.id, headers },
    runAt,
    idempotencyKey: retryJobKey(row.id),
    maxAttempts: remaining,
    priority: 5,
  });
  if (id) return;
  // A pending job already holds the key, typically the hold job of a row that waited for Gmail (due only at the end of
  // the 24 hour hold window): bring it forward so this failure is retried with backoff, not a day later.
  await db
    .update(jobs)
    .set({ runAt, maxAttempts: sql`${jobs.attempts} + ${remaining}`, payload: { outboxId: row.id, headers }, updatedAt: now() })
    .where(and(eq(jobs.idempotencyKey, retryJobKey(row.id)), eq(jobs.status, "pending"), gt(jobs.runAt, runAt)));
}

/**
 * The retry job of a held row: it carries the delivery headers (List-Unsubscribe is not stored on the outbox row) and
 * runs when the hold window ends, unless a release makes it due earlier (releaseHeldEmails).
 */
async function scheduleHoldJob(db: DbOrTx, row: OutboxRow, headers: Record<string, string>): Promise<void> {
  const runAt = new Date(Math.max(row.createdAt.getTime() + GMAIL_HOLD_MAX_MS + 60_000, nowMs() + 60_000));
  await enqueueOrReviveJob(db, {
    type: "email.retry",
    payload: { outboxId: row.id, headers },
    runAt,
    idempotencyKey: retryJobKey(row.id),
    maxAttempts: 1,
    priority: 5,
  });
}

const retryJobKey = (outboxId: string) => `email.retry:${outboxId}`;

const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Header map from untrusted input (job payloads): valid names, sanitized string values, and none of the headers the
 * message structure owns (recipients, sender, subject, Message-ID, MIME headers), so a payload can never add a
 * recipient or replace the sender.
 */
export function cleanHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v !== "string" || !HEADER_NAME.test(k) || isReservedHeader(k)) continue;
    const value = sanitizeHeaderValue(v, 998);
    if (value) out[k] = value;
  }
  return out;
}

/**
 * The headers of a row's first delivery, carried by its email.retry job (List-Unsubscribe is not stored on the
 * outbox row), so a re-send carries the same headers and the provider sees the same request.
 */
async function storedRetryHeaders(db: DbOrTx, outboxId: string): Promise<Record<string, string>> {
  const [job] = await db.select({ payload: jobs.payload }).from(jobs).where(eq(jobs.idempotencyKey, retryJobKey(outboxId))).limit(1);
  return cleanHeaders((job?.payload as { headers?: unknown } | undefined)?.headers);
}

/** Rows that may be (re)delivered: failed or queued, plus interrupted "sending" ones when includeStale. */
function claimableStatus(at: Date, includeStale: boolean | undefined) {
  const stale = new Date(at.getTime() - EMAIL_STALE_SENDING_MS);
  return includeStale
    ? or(inArray(emailOutbox.status, ["failed", "queued"]), and(eq(emailOutbox.status, "sending"), lt(emailOutbox.updatedAt, stale)))
    : inArray(emailOutbox.status, ["failed", "queued"]);
}

/** Claims an existing row for delivery (failed or queued, or interrupted "sending"), counting the attempt. */
async function claimRow(db: DbOrTx, id: string, opts: { includeStale?: boolean } = {}): Promise<OutboxRow | null> {
  const at = now();
  const [row] = await db
    .update(emailOutbox)
    .set({ status: "sending", attempts: sql`${emailOutbox.attempts} + 1`, updatedAt: at })
    .where(and(eq(emailOutbox.id, id), claimableStatus(at, opts.includeStale), isNull(emailOutbox.bodyPurgedAt)))
    .returning();
  return row ?? null;
}

/**
 * Makes a row wait for Gmail without spending a delivery attempt (Gmail is the transport but cannot send right now):
 * failed, with the hold reason. Returns the row, or null when another worker changed it meanwhile.
 */
async function holdRow(db: DbOrTx, id: string, reason: string, opts: { includeStale?: boolean } = {}): Promise<OutboxRow | null> {
  const at = now();
  const [row] = await db
    .update(emailOutbox)
    .set({ status: "failed", provider: "gmail", lastError: `${GMAIL_HOLD_PREFIX}${reason}`.slice(0, 2000), updatedAt: at })
    .where(and(eq(emailOutbox.id, id), claimableStatus(at, opts.includeStale), isNull(emailOutbox.bodyPurgedAt)))
    .returning();
  if (row) log.warn("email.held", { id, template: row.template, error: reason, outbox: outboxLink() });
  return row ?? null;
}

/**
 * Why a held email must not be sent any more, or null. Checked whenever a held row is about to be delivered (after a
 * reconnect, or when its job runs at the end of the hold window).
 */
async function heldGiveUpReason(db: DbOrTx, row: OutboxRow): Promise<string | null> {
  const age = nowMs() - row.createdAt.getTime();
  if (age > GMAIL_HOLD_MAX_MS) return "Not sent: Gmail could not send it within 24 hours.";
  if (isTimeSensitive(row) && age > GMAIL_HOLD_TIME_SENSITIVE_MS) {
    return "Not sent: it contained a code or link that expires within minutes, and Gmail could not send it in time.";
  }
  if (row.category === "system") return "Not sent: this notice was out of date before Gmail could send it.";
  if (row.scheduledEventId) {
    const [meeting] = await db
      .select({ startAt: scheduledEvents.startAt, status: scheduledEvents.status })
      .from(scheduledEvents)
      .where(eq(scheduledEvents.id, row.scheduledEventId))
      .limit(1);
    if (meeting && meeting.startAt.getTime() <= nowMs()) return "Not sent: the meeting started before Gmail could send it.";
    // A confirmation, update or reminder of a meeting canceled meanwhile would contradict the cancellation email (and its
    // invitation could put the canceled meeting back in the invitee's calendar).
    if (meeting?.status === "canceled" && !isAboutCancellation(row)) return "Not sent: the meeting was canceled before Gmail could send it.";
  }
  return null;
}

/** Marks a held row failed for good (no more attempts). */
async function giveUpHeld(db: DbOrTx, row: OutboxRow, reason: string): Promise<void> {
  const at = now();
  const original = row.lastError?.startsWith(GMAIL_HOLD_PREFIX) ? row.lastError.slice(GMAIL_HOLD_PREFIX.length) : "";
  await db
    .update(emailOutbox)
    .set({ status: "failed", lastError: `${PERMANENT_PREFIX}${reason}${original ? ` ${original}` : ""}`.slice(0, 2000), updatedAt: at })
    .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "failed")));
  log.warn("email.hold_given_up", { id: row.id, template: row.template, reason });
}

/** The METHOD line of an iCalendar document ("REQUEST", "CANCEL", "PUBLISH"), or null. */
export function icsMethodOf(content: string): IcsMethod | null {
  const m = /^METHOD:([A-Z]+)\s*$/m.exec(content);
  const v = m?.[1];
  return v === "REQUEST" || v === "CANCEL" || v === "PUBLISH" ? v : null;
}

/**
 * The ICS to store and send: dropped when empty; the method follows the document's own METHOD line so the
 * text/calendar content type always matches what calendar clients read (a mismatch would turn a cancellation into
 * an invitation).
 */
function normalizeIcs(ics: EmailMessage["ics"], template: string): { method: IcsMethod; content: string } | null {
  if (!ics?.content?.trim()) return null;
  const declared = icsMethodOf(ics.content);
  if (declared && declared !== ics.method) log.warn("email.ics_method_mismatch", { template, given: ics.method, ics: declared });
  return { method: declared ?? ics.method, content: ics.content };
}

const isPermanent = (row: Pick<OutboxRow, "lastError">) => Boolean(row.lastError?.startsWith(PERMANENT_PREFIX));

function publicStatus(status: OutboxRow["status"]): SendEmailResult["status"] {
  return status === "sending" ? "queued" : status;
}

/**
 * Sends one email (see the file header). Idempotent by msg.idempotencyKey: a second call returns the first row
 * (deduplicated) and, when that row failed with a retryable error (or waits for Gmail and Gmail can send again), tries
 * it again right away.
 */
export async function sendEmail(msg: EmailMessage): Promise<SendEmailResult> {
  if (!msg.idempotencyKey?.trim()) throw new AppError("validation", "sendEmail: idempotencyKey is required");
  const db = await getDb();
  const resolution = await resolveEmailTransport(db);
  const transport = resolution.name;
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
  // Gmail is the transport but cannot send right now: the row waits (failed, with the reason) without an attempt.
  const held = transport === "gmail" && Boolean(resolution.hold) && !noRecipients;
  // Gmail sends as the owner: record that mailbox on the row (the outbox page shows what recipients see).
  const gmailFrom = transport === "gmail" && resolution.gmail ? resolution.gmail : null;
  const ics = normalizeIcs(msg.ics, msg.template);
  const skipped = invalid.length ? `Skipped invalid addresses: ${invalid.join(", ")}` : null;

  const inserted = await db
    .insert(emailOutbox)
    .values({
      organizationId: msg.related?.organizationId ?? null,
      toAddresses: noRecipients ? to.invalid.slice(0, 10) : to.valid,
      ccAddresses: cc.valid,
      bccAddresses: bcc.valid,
      fromAddress: gmailFrom?.address ?? sender.address,
      fromName: gmailFrom
        ? gmailFromName(gmailFrom)
        : msg.fromName?.trim()
          ? sanitizeHeaderValue(msg.fromName, 200)
          : sender.name,
      replyTo,
      subject: sanitizeHeaderValue(msg.subject || "(no subject)"),
      html: msg.html,
      text: msg.text,
      attachments: (msg.attachments ?? []).map((a) => ({
        filename: sanitizeHeaderValue(a.filename, 200) || "attachment",
        contentType: sanitizeHeaderValue(a.contentType, 200) || "application/octet-stream",
        contentBase64: toBase64(a.content),
      })),
      icsMethod: ics?.method ?? null,
      ics: ics?.content ?? null,
      template: msg.template,
      category: msg.category,
      status: noRecipients || held ? "failed" : stored ? "stored" : "sending",
      provider: transport,
      attempts: noRecipients || stored || held ? 0 : 1,
      lastError: noRecipients
        ? `${PERMANENT_PREFIX}no valid recipients`
        : held
          ? `${GMAIL_HOLD_PREFIX}${resolution.hold}${skipped ? ` ${skipped}` : ""}`.slice(0, 2000)
          : skipped
            ? skipped.slice(0, 2000)
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
      log.info("email.stored", { id: row.id, template: msg.template, outbox: outboxLink() });
      return { id: row.id, status: "stored", deduplicated: false };
    }
    if (held) {
      log.warn("email.held", { id: row.id, template: msg.template, error: resolution.hold, outbox: outboxLink() });
      await scheduleHoldJob(db, row, headers);
      return { id: row.id, status: "failed", deduplicated: false };
    }
    const done = await finishDelivery(db, row, headers, resolution);
    if (done.outcome === "retry") await scheduleRetry(db, row, headers, done.retryAfterMs);
    if (done.outcome === "held") await scheduleHoldJob(db, row, headers);
    return { id: row.id, status: done.outcome === "retry" || done.outcome === "held" ? "failed" : done.outcome, deduplicated: false };
  }

  const [existing] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, msg.idempotencyKey)).limit(1);
  if (!existing) throw new Error("sendEmail: outbox row vanished");
  if ((existing.status === "failed" || existing.status === "queued") && !isPermanent(existing) && existing.attempts < EMAIL_MAX_ATTEMPTS) {
    if (isHeldForGmail(existing)) {
      // Still waiting for Gmail: nothing to try. Gmail can send again: deliver now unless it is no longer useful.
      if (resolution.hold) return { id: existing.id, status: "failed", deduplicated: true };
      const giveUp = await heldGiveUpReason(db, existing);
      if (giveUp) {
        await giveUpHeld(db, existing, giveUp);
        return { id: existing.id, status: "failed", deduplicated: true };
      }
    } else if (transport === "gmail" && resolution.hold) {
      // An earlier failure, but Gmail cannot send right now: wait for it without spending an attempt.
      const heldNow = await holdRow(db, existing.id, resolution.hold);
      if (heldNow) await scheduleHoldJob(db, heldNow, headers);
      return { id: existing.id, status: "failed", deduplicated: true };
    }
    const claimed = await claimRow(db, existing.id);
    if (claimed) {
      const done = await finishDelivery(db, claimed, headers, resolution);
      if (done.outcome === "retry") await scheduleRetry(db, claimed, headers, done.retryAfterMs);
      if (done.outcome === "held") await scheduleHoldJob(db, claimed, headers);
      return { id: claimed.id, status: done.outcome === "retry" || done.outcome === "held" ? "failed" : done.outcome, deduplicated: true };
    }
    const [fresh] = await db.select({ status: emailOutbox.status }).from(emailOutbox).where(eq(emailOutbox.id, existing.id));
    return { id: existing.id, status: publicStatus(fresh?.status ?? existing.status), deduplicated: true };
  }
  return { id: existing.id, status: publicStatus(existing.status), deduplicated: true };
}

export type RetryEmailOutcome = "sent" | "stored" | "failed" | "retry" | "held" | "skipped" | "in_flight";

/**
 * Retries delivery of one outbox row (the email.retry job). "retry" means the attempt failed with a retryable error
 * (the job throws so the runner backs off); "in_flight" means another worker is delivering it right now (the job
 * retries later, after the interrupted-delivery window); "held" means it waits for Gmail (the owner's Google
 * connection needs a reconnect); "failed" means the row is out of attempts or no longer worth sending; "skipped" means
 * there was nothing to do (already sent or stored, permanently failed, purged, or still waiting for Gmail).
 * `headers` defaults to the headers of the first delivery (carried by the row's retry job).
 */
export async function retryEmailDelivery(outboxId: string, headers?: Record<string, string>): Promise<RetryEmailOutcome> {
  const db = await getDb();
  const [current] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, outboxId)).limit(1);
  if (!current || isPermanent(current) || current.bodyPurgedAt) return "skipped";
  if (current.status === "sent" || current.status === "stored") return "skipped";
  const staleBefore = nowMs() - EMAIL_STALE_SENDING_MS;
  if (current.status === "sending" && current.updatedAt.getTime() >= staleBefore) return "in_flight";
  const resolution = await resolveEmailTransport(db);
  if (isHeldForGmail(current)) {
    const giveUp = await heldGiveUpReason(db, current);
    if (giveUp) {
      await giveUpHeld(db, current, giveUp);
      return "failed";
    }
    if (resolution.hold) return "skipped"; // still waiting: no attempt is spent
  }
  if (current.attempts >= EMAIL_MAX_ATTEMPTS) {
    // Out of attempts (a stale "sending" row means the last attempt was interrupted): give up for good.
    const at = now();
    await db
      .update(emailOutbox)
      .set({
        status: "failed",
        lastError: `${PERMANENT_PREFIX}gave up after ${current.attempts} attempts${current.lastError ? `: ${current.lastError}` : ""}`.slice(0, 2000),
        updatedAt: at,
      })
      .where(and(eq(emailOutbox.id, outboxId), inArray(emailOutbox.status, ["failed", "queued", "sending"])));
    log.warn("email.gave_up", { id: outboxId, template: current.template, attempts: current.attempts });
    return "failed";
  }
  if (resolution.name === "gmail" && resolution.hold) {
    // Not held yet (an earlier retryable failure), but Gmail cannot send right now: wait without spending an attempt.
    // The sweep (releaseHeldEmails) makes its job due again once Gmail can send.
    if (await holdRow(db, outboxId, resolution.hold, { includeStale: true })) return "held";
    const [fresh] = await db.select({ status: emailOutbox.status }).from(emailOutbox).where(eq(emailOutbox.id, outboxId));
    return fresh?.status === "sending" ? "in_flight" : "skipped";
  }
  const claimed = await claimRow(db, outboxId, { includeStale: true });
  if (!claimed) {
    const [fresh] = await db.select({ status: emailOutbox.status }).from(emailOutbox).where(eq(emailOutbox.id, outboxId));
    return fresh?.status === "sending" ? "in_flight" : "skipped";
  }
  const merged = { ...emailHeaders({ listUnsubscribe: null }), ...(headers ?? (await storedRetryHeaders(db, outboxId))) };
  const done = await finishDelivery(db, claimed, merged, resolution);
  // Held now: keep (or create) the job that carries the headers; while this very job runs it is left as is.
  if (done.outcome === "held") await scheduleHoldJob(db, claimed, merged);
  return done.outcome;
}

/**
 * Makes held rows' email.retry jobs due now once Gmail can send again (the owner reconnected Google, or another
 * transport was configured), and gives up held rows that are no longer worth sending. Returns the ids of the jobs made
 * due (run them with the job runner).
 */
export async function releaseHeldEmails(opts: { limit?: number; db?: DbOrTx } = {}): Promise<string[]> {
  const db = opts.db ?? (await getDb());
  const held = await db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "failed"), like(emailOutbox.lastError, `${GMAIL_HOLD_PREFIX}%`), isNull(emailOutbox.bodyPurgedAt)))
    .orderBy(emailOutbox.createdAt)
    .limit(opts.limit ?? 50);
  if (!held.length) return [];
  const resolution = await resolveEmailTransport(db);
  const jobIds: string[] = [];
  for (const row of held) {
    const giveUp = await heldGiveUpReason(db, row);
    if (giveUp) {
      await giveUpHeld(db, row, giveUp);
      continue;
    }
    if (resolution.hold) continue; // Gmail still cannot send: keep waiting
    const at = now();
    const maxAttempts = Math.max(1, EMAIL_MAX_ATTEMPTS - row.attempts);
    const [moved] = await db
      .update(jobs)
      .set({ runAt: at, attempts: 0, maxAttempts, updatedAt: at })
      .where(and(eq(jobs.idempotencyKey, retryJobKey(row.id)), eq(jobs.status, "pending")))
      .returning({ id: jobs.id });
    const id =
      moved?.id ??
      (await enqueueOrReviveJob(db, {
        type: "email.retry",
        payload: { outboxId: row.id, headers: { ...emailHeaders({ listUnsubscribe: null }), ...(await storedRetryHeaders(db, row.id)) } },
        runAt: at,
        idempotencyKey: retryJobKey(row.id),
        maxAttempts,
        priority: 5,
      }));
    if (id) jobIds.push(id);
  }
  if (jobIds.length) log.info("email.held_released", { count: jobIds.length, provider: resolution.name });
  return jobIds;
}

/** Emails waiting for Gmail (the owner's Google connection needs a reconnect), for the Integrations page. */
export async function countHeldEmails(db?: DbOrTx): Promise<number> {
  const d = db ?? (await getDb());
  const [row] = await d
    .select({ n: count() })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "failed"), like(emailOutbox.lastError, `${GMAIL_HOLD_PREFIX}%`), isNull(emailOutbox.bodyPurgedAt)));
  return Number(row?.n ?? 0);
}

/**
 * Re-sends rows interrupted mid-delivery ("sending" or "queued" for more than 10 minutes) and failed rows with a
 * retryable error whose retry job is gone (lost between two statements, or exhausted by runner errors), then releases
 * held emails once Gmail can send again (releaseHeldEmails). Returns how many were tried or released.
 */
export async function sweepStuckEmails(limit = 20): Promise<number> {
  const db = await getDb();
  const stale = new Date(nowMs() - EMAIL_STALE_SENDING_MS);
  const activeRetry = sql`exists (select 1 from ${jobs} where ${jobs.idempotencyKey} = 'email.retry:' || ${emailOutbox.id}::text
    and ${jobs.status} in ('pending', 'running'))`;
  const rows = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(
      and(
        lt(emailOutbox.updatedAt, stale),
        isNull(emailOutbox.bodyPurgedAt),
        or(
          inArray(emailOutbox.status, ["sending", "queued"]),
          and(
            eq(emailOutbox.status, "failed"),
            lt(emailOutbox.attempts, EMAIL_MAX_ATTEMPTS),
            or(
              isNull(emailOutbox.lastError),
              and(notLike(emailOutbox.lastError, `${PERMANENT_PREFIX}%`), notLike(emailOutbox.lastError, `${GMAIL_HOLD_PREFIX}%`)),
            ),
            sql`not ${activeRetry}`,
          ),
        ),
      ),
    )
    .orderBy(emailOutbox.updatedAt)
    .limit(limit);
  let tried = 0;
  for (const r of rows) {
    const headers = await storedRetryHeaders(db, r.id);
    const outcome = await retryEmailDelivery(r.id, headers);
    if (outcome === "skipped" || outcome === "in_flight") continue;
    tried++;
    if (outcome === "retry") {
      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, r.id));
      if (row) await scheduleRetry(db, row, { ...emailHeaders({ listUnsubscribe: null }), ...headers });
    }
  }
  const released = await releaseHeldEmails({ db, limit: limit * 2 });
  return tried + released.length;
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
