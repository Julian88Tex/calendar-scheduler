// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// sendSms (SPEC NT-16, GEN-15; ARCHITECTURE section 13.4). Every text is an sms_messages row (idempotent by key), then:
//   skipped  opted-out numbers (sms_opt_outs), unsupported countries (+7, +65, +98), and the anti pumping caps:
//            more than 10 texts to one number in 24 hours, or 3 failed deliveries to it in the last 24 hours
//   stored   no Twilio configuration (the SMS log, Admin > SMS)
//   sent     Twilio REST POST /2010-04-01/Accounts/{sid}/Messages.json (Basic auth, From or MessagingServiceSid)
//   failed   a Twilio error; retryable ones (network, 429, 5xx, credentials) get an sms.retry job with backoff
// Twilio error 21610 (the recipient replied STOP to the sender) records an opt-out. Times use the app clock.
import "server-only";
import { and, count, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { rateLimitBuckets, smsMessages, smsOptOuts } from "@/db/schema";
import { sha256Hex } from "../crypto";
import { getEnv } from "../env";
import { enqueueOrReviveJob } from "../jobs/queue";
import { log } from "../logger";
import { rateLimit } from "../rate-limit";
import { now, nowMs } from "../time/now";
import { absoluteUrl, appUrl } from "../url";
import { isUnsupportedSmsCountry, maskPhone, normalizePhone, smsSegments } from "./segments";

export type SendSmsInput = {
  /** E.164 destination. */
  to: string;
  body: string;
  idempotencyKey: string;
  related?: { organizationId?: string; scheduledEventId?: string; inviteeId?: string; workflowExecutionId?: string };
};

export type SendSmsResult = {
  id: string;
  status: "sent" | "stored" | "failed" | "skipped";
  reason?: "opted_out" | "unsupported_country" | "rate_limited";
};

export type SmsRow = typeof smsMessages.$inferSelect;

/** NT-16 anti pumping caps. */
export const SMS_DAILY_CAP_PER_NUMBER = 10;
export const SMS_FAILURE_PAUSE_COUNT = 3;
export const SMS_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SMS_MAX_ATTEMPTS = 8;
/** Twilio's hard body limit (bodies are composed shorter, NT-16). */
const TWILIO_MAX_BODY = 1600;
/** A text left in "queued" longer than this was interrupted mid-delivery and is re-sent by the sweep. */
export const SMS_STALE_QUEUED_MS = 10 * 60 * 1000;
const PERMANENT_PREFIX = "permanent: ";

// Twilio error codes that will never succeed for this message.
const TWILIO_PERMANENT = new Set([21211, 21212, 21214, 21215, 21217, 21401, 21402, 21407, 21408, 21421, 21602, 21604, 21606, 21608, 21612, 21614, 21617, 21635, 21659, 21660, 30003, 30005, 30006, 30007]);
const TWILIO_UNSUBSCRIBED = 21610;

type TwilioConfig = { accountSid: string; authToken: string; from?: string; messagingServiceSid?: string };

function twilioConfig(): TwilioConfig | null {
  const e = getEnv();
  if (!e.TWILIO_ACCOUNT_SID || !e.TWILIO_AUTH_TOKEN || !(e.TWILIO_FROM_NUMBER || e.TWILIO_MESSAGING_SERVICE_SID)) return null;
  return {
    accountSid: e.TWILIO_ACCOUNT_SID,
    authToken: e.TWILIO_AUTH_TOKEN,
    from: e.TWILIO_FROM_NUMBER,
    messagingServiceSid: e.TWILIO_MESSAGING_SERVICE_SID,
  };
}

/** Which transport sends SMS. */
export function smsTransportName(): "twilio" | "outbox" {
  return twilioConfig() ? "twilio" : "outbox";
}

/** True when the number opted out (inbound STOP or a manual opt-out). */
export async function isSmsOptedOut(phone: string, db?: DbOrTx): Promise<boolean> {
  const e164 = normalizePhone(phone) ?? phone;
  const d = db ?? (await getDb());
  const [row] = await d.select({ phone: smsOptOuts.phone }).from(smsOptOuts).where(eq(smsOptOuts.phone, e164)).limit(1);
  return Boolean(row);
}

/** Records an opt-out (inbound "STOP" via the Twilio webhook, or manual). Idempotent. */
export async function recordSmsOptOut(phone: string, source: "stop" | "manual" = "stop", db?: DbOrTx): Promise<void> {
  const e164 = normalizePhone(phone);
  if (!e164) return;
  const d = db ?? (await getDb());
  await d.insert(smsOptOuts).values({ phone: e164, source, createdAt: now() }).onConflictDoNothing({ target: smsOptOuts.phone });
  log.info("sms.opted_out", { phone: maskPhone(e164), source });
}

/** Removes an opt-out (inbound "START" or "UNSTOP"). */
export async function removeSmsOptOut(phone: string, db?: DbOrTx): Promise<void> {
  const e164 = normalizePhone(phone);
  if (!e164) return;
  const d = db ?? (await getDb());
  await d.delete(smsOptOuts).where(eq(smsOptOuts.phone, e164));
}

function capKey(e164: string): string {
  return `sms:to:${sha256Hex(e164).slice(0, 32)}`;
}

/** Texts counted toward the 24 hour cap for a number (rolling, hourly buckets). */
async function countRecentTexts(db: DbOrTx, e164: string, at: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<string | number>`coalesce(sum(${rateLimitBuckets.count}), 0)` })
    .from(rateLimitBuckets)
    .where(and(eq(rateLimitBuckets.key, capKey(e164)), gt(rateLimitBuckets.windowStart, new Date(at - SMS_WINDOW_MS))));
  return Number(row?.n ?? 0);
}

async function recentFailures(db: DbOrTx, e164: string, at: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(smsMessages)
    .where(and(eq(smsMessages.toNumber, e164), eq(smsMessages.status, "failed"), gt(smsMessages.createdAt, new Date(at - SMS_WINDOW_MS))));
  return Number(row?.n ?? 0);
}

type TwilioOutcome =
  | { ok: true; sid: string; segments: number | null }
  | { ok: false; retryable: boolean; error: string; unsubscribed?: boolean };

async function sendWithTwilio(cfg: TwilioConfig, to: string, body: string): Promise<TwilioOutcome> {
  const form = new URLSearchParams({ To: to, Body: body });
  if (cfg.messagingServiceSid) form.set("MessagingServiceSid", cfg.messagingServiceSid);
  else if (cfg.from) form.set("From", cfg.from);
  // Delivery receipts need a public https URL (the workflows Twilio webhook handles MessageStatus callbacks).
  const base = appUrl();
  if (base.startsWith("https://") && !/\/\/(localhost|127\.0\.0\.1)/.test(base)) form.set("StatusCallback", absoluteUrl("/api/webhooks/twilio"));
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; num_segments?: string | number; code?: number; message?: string };
    if (res.ok && data.sid) {
      const segments = data.num_segments !== undefined ? Number(data.num_segments) : null;
      return { ok: true, sid: data.sid, segments: Number.isFinite(segments) ? segments : null };
    }
    const code = typeof data.code === "number" ? data.code : 0;
    const error = `twilio ${res.status}${code ? ` ${code}` : ""}: ${data.message ?? res.statusText}`.slice(0, 2000);
    if (code === TWILIO_UNSUBSCRIBED) return { ok: false, retryable: false, error, unsubscribed: true };
    const retryable = res.status === 429 || res.status >= 500 || res.status === 401 || (!TWILIO_PERMANENT.has(code) && res.status !== 400);
    return { ok: false, retryable, error };
  } catch (e) {
    return { ok: false, retryable: true, error: `twilio: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(attempts - 1, 0), 6 * 60 * 60 * 1000);
}

async function scheduleRetry(db: DbOrTx, row: Pick<SmsRow, "id" | "attempts">): Promise<void> {
  // One retry job per text, revived when an earlier one already finished.
  await enqueueOrReviveJob(db, {
    type: "sms.retry",
    payload: { smsId: row.id },
    runAt: new Date(nowMs() + backoffMs(row.attempts)),
    idempotencyKey: `sms.retry:${row.id}`,
    maxAttempts: Math.max(1, SMS_MAX_ATTEMPTS - row.attempts),
    priority: 5,
  });
}

/** Sends a row in "queued" state owned by the caller and records the outcome. */
async function deliver(db: DbOrTx, row: SmsRow): Promise<"sent" | "stored" | "failed" | "retry" | "skipped"> {
  const cfg = twilioConfig();
  const at = now();
  if (!cfg) {
    await db
      .update(smsMessages)
      .set({ status: "stored", provider: "outbox", sentAt: at, updatedAt: at, lastError: null })
      .where(and(eq(smsMessages.id, row.id), eq(smsMessages.status, "queued")));
    log.info("sms.stored", { id: row.id, to: maskPhone(row.toNumber) });
    return "stored";
  }
  const out = await sendWithTwilio(cfg, row.toNumber, row.body);
  const done = now();
  if (out.ok) {
    await db
      .update(smsMessages)
      .set({
        status: "sent",
        provider: "twilio",
        providerSid: out.sid,
        fromNumber: cfg.messagingServiceSid ? null : (cfg.from ?? null),
        segments: out.segments ?? row.segments,
        sentAt: done,
        updatedAt: done,
        lastError: null,
      })
      .where(and(eq(smsMessages.id, row.id), eq(smsMessages.status, "queued")));
    log.info("sms.sent", { id: row.id, to: maskPhone(row.toNumber) });
    return "sent";
  }
  if (out.unsubscribed) {
    await recordSmsOptOut(row.toNumber, "stop", db);
    await db
      .update(smsMessages)
      .set({ status: "skipped", provider: "twilio", lastError: `opted_out: ${out.error}`, updatedAt: done })
      .where(and(eq(smsMessages.id, row.id), eq(smsMessages.status, "queued")));
    return "skipped";
  }
  const retry = out.retryable && row.attempts < SMS_MAX_ATTEMPTS;
  await db
    .update(smsMessages)
    .set({ status: "failed", provider: "twilio", lastError: (out.retryable ? out.error : `${PERMANENT_PREFIX}${out.error}`).slice(0, 2000), updatedAt: done })
    .where(and(eq(smsMessages.id, row.id), eq(smsMessages.status, "queued")));
  log.warn("sms.failed", { id: row.id, to: maskPhone(row.toNumber), retry, error: out.error });
  return retry ? "retry" : "failed";
}

function publicStatus(status: SmsRow["status"]): SendSmsResult["status"] {
  return status === "queued" ? "stored" : status;
}

function reasonOf(row: Pick<SmsRow, "status" | "lastError">): SendSmsResult["reason"] {
  if (row.status !== "skipped") return undefined;
  const e = row.lastError ?? "";
  if (e.startsWith("opted_out")) return "opted_out";
  if (e.startsWith("unsupported_country")) return "unsupported_country";
  return "rate_limited";
}

/** Sends one text message (see the file header). */
export async function sendSms(p: SendSmsInput): Promise<SendSmsResult> {
  if (!p.idempotencyKey?.trim()) throw new Error("sendSms: idempotencyKey is required");
  const db = await getDb();
  const [existing] = await db.select().from(smsMessages).where(eq(smsMessages.idempotencyKey, p.idempotencyKey)).limit(1);
  if (existing) return { id: existing.id, status: publicStatus(existing.status), reason: reasonOf(existing) };

  const e164 = normalizePhone(p.to);
  const body = (p.body ?? "").replace(/\r\n?/g, "\n").trim().slice(0, TWILIO_MAX_BODY);
  const atMs = nowMs();
  const at = new Date(atMs);
  const base = {
    organizationId: p.related?.organizationId ?? null,
    toNumber: e164 ?? String(p.to ?? "").slice(0, 32),
    body,
    segments: smsSegments(body).segments,
    idempotencyKey: p.idempotencyKey,
    scheduledEventId: p.related?.scheduledEventId ?? null,
    inviteeId: p.related?.inviteeId ?? null,
    workflowExecutionId: p.related?.workflowExecutionId ?? null,
    provider: smsTransportName(),
    createdAt: at,
    updatedAt: at,
  };

  const finishSkip = async (status: "skipped" | "failed", lastError: string, reason?: SendSmsResult["reason"]) => {
    const rows = await db
      .insert(smsMessages)
      .values({ ...base, status, attempts: 0, lastError })
      .onConflictDoNothing({ target: smsMessages.idempotencyKey })
      .returning();
    const row = rows[0] ?? (await db.select().from(smsMessages).where(eq(smsMessages.idempotencyKey, p.idempotencyKey)))[0]!;
    log.info(`sms.${status}`, { id: row.id, to: e164 ? maskPhone(e164) : "invalid", reason: reason ?? lastError });
    return { id: row.id, status: publicStatus(row.status), reason: reasonOf(row) } satisfies SendSmsResult;
  };

  if (!e164) return finishSkip("failed", `${PERMANENT_PREFIX}invalid phone number`);
  if (!body) return finishSkip("failed", `${PERMANENT_PREFIX}empty message`);
  if (await isSmsOptedOut(e164, db)) return finishSkip("skipped", "opted_out", "opted_out");
  if (isUnsupportedSmsCountry(e164)) return finishSkip("skipped", "unsupported_country", "unsupported_country");
  if ((await recentFailures(db, e164, atMs)) >= SMS_FAILURE_PAUSE_COUNT) {
    return finishSkip("skipped", "rate_limited: paused for 24 hours after 3 failed deliveries", "rate_limited");
  }
  await rateLimit(capKey(e164), SMS_DAILY_CAP_PER_NUMBER, 3600, { db, nowMs: atMs });
  if ((await countRecentTexts(db, e164, atMs)) > SMS_DAILY_CAP_PER_NUMBER) {
    return finishSkip("skipped", "rate_limited: more than 10 texts to this number in 24 hours", "rate_limited");
  }

  const inserted = await db
    .insert(smsMessages)
    .values({ ...base, status: "queued", attempts: 1 })
    .onConflictDoNothing({ target: smsMessages.idempotencyKey })
    .returning();
  const row = inserted[0];
  if (!row) {
    const [dup] = await db.select().from(smsMessages).where(eq(smsMessages.idempotencyKey, p.idempotencyKey));
    return { id: dup!.id, status: publicStatus(dup!.status), reason: reasonOf(dup!) };
  }
  const outcome = await deliver(db, row);
  if (outcome === "retry") await scheduleRetry(db, row);
  if (outcome === "skipped") return { id: row.id, status: "skipped", reason: "opted_out" };
  return { id: row.id, status: outcome === "retry" ? "failed" : outcome };
}

/**
 * Retries one failed (or interrupted) text: the sms.retry job. "retry" means try again later; "in_flight" means
 * another worker is sending it right now; "failed" means it is out of attempts.
 */
export async function retrySmsDelivery(smsId: string): Promise<"sent" | "stored" | "failed" | "retry" | "skipped" | "in_flight"> {
  const db = await getDb();
  const at = now();
  const stale = new Date(at.getTime() - SMS_STALE_QUEUED_MS);
  const [current] = await db.select().from(smsMessages).where(eq(smsMessages.id, smsId)).limit(1);
  if (!current || current.lastError?.startsWith(PERMANENT_PREFIX)) return "skipped";
  if (current.status !== "failed" && current.status !== "queued") return "skipped";
  if (current.status === "queued" && current.updatedAt.getTime() >= stale.getTime()) return "in_flight";
  if (await isSmsOptedOut(current.toNumber, db)) {
    await db
      .update(smsMessages)
      .set({ status: "skipped", lastError: "opted_out", updatedAt: at })
      .where(and(eq(smsMessages.id, smsId), inArray(smsMessages.status, ["failed", "queued"])));
    return "skipped";
  }
  if (current.attempts >= SMS_MAX_ATTEMPTS) {
    await db
      .update(smsMessages)
      .set({
        status: "failed",
        lastError: `${PERMANENT_PREFIX}gave up after ${current.attempts} attempts${current.lastError ? `: ${current.lastError}` : ""}`.slice(0, 2000),
        updatedAt: at,
      })
      .where(and(eq(smsMessages.id, smsId), inArray(smsMessages.status, ["failed", "queued"])));
    return "failed";
  }
  const [claimed] = await db
    .update(smsMessages)
    .set({ status: "queued", attempts: sql`${smsMessages.attempts} + 1`, updatedAt: at })
    .where(
      and(
        eq(smsMessages.id, smsId),
        sql`(${smsMessages.status} = 'failed' or (${smsMessages.status} = 'queued' and ${smsMessages.updatedAt} < ${stale.toISOString()}::timestamptz))`,
      ),
    )
    .returning();
  if (!claimed) return "skipped";
  return deliver(db, claimed);
}

/** Re-sends texts interrupted mid-delivery (queued for more than 10 minutes). */
export async function sweepStuckSms(limit = 20): Promise<number> {
  const db = await getDb();
  const stale = new Date(nowMs() - SMS_STALE_QUEUED_MS);
  const rows = await db
    .select({ id: smsMessages.id })
    .from(smsMessages)
    .where(and(eq(smsMessages.status, "queued"), lt(smsMessages.updatedAt, stale)))
    .limit(limit);
  let tried = 0;
  for (const r of rows) {
    const outcome = await retrySmsDelivery(r.id);
    if (outcome === "skipped" || outcome === "in_flight") continue;
    tried++;
    if (outcome === "retry") {
      const [row] = await db.select({ id: smsMessages.id, attempts: smsMessages.attempts }).from(smsMessages).where(eq(smsMessages.id, r.id));
      if (row) await scheduleRetry(db, row);
    }
  }
  return tried;
}

/**
 * Applies a Twilio delivery status callback (MessageSid, MessageStatus, ErrorCode) to the SMS log: delivered and sent
 * mark the row sent, failed and undelivered mark it failed (counting toward the 3 failures pause); error 21610 records
 * an opt-out. Returns false when no row has that sid. Called by the workflows Twilio webhook after it verified the
 * signature.
 */
export async function applySmsStatusCallback(p: { messageSid: string; messageStatus: string; errorCode?: string | number | null }): Promise<boolean> {
  if (!p.messageSid) return false;
  const db = await getDb();
  const at = now();
  const status = p.messageStatus.toLowerCase();
  const code = p.errorCode !== undefined && p.errorCode !== null && `${p.errorCode}` !== "" ? Number(p.errorCode) : null;
  const [row] = await db.select().from(smsMessages).where(eq(smsMessages.providerSid, p.messageSid)).limit(1);
  if (!row) return false;
  if (status === "failed" || status === "undelivered") {
    await db
      .update(smsMessages)
      .set({ status: "failed", lastError: `${PERMANENT_PREFIX}twilio ${status}${code ? ` ${code}` : ""}`, updatedAt: at })
      .where(eq(smsMessages.id, row.id));
    if (code === TWILIO_UNSUBSCRIBED) await recordSmsOptOut(row.toNumber, "stop", db);
  } else if (status === "delivered") {
    await db.update(smsMessages).set({ status: "sent", lastError: null, updatedAt: at }).where(eq(smsMessages.id, row.id));
  } else if (status === "sent") {
    // Callbacks can arrive out of order: a late "sent" never undoes a "failed" or "undelivered" receipt.
    await db
      .update(smsMessages)
      .set({ status: "sent", updatedAt: at })
      .where(and(eq(smsMessages.id, row.id), inArray(smsMessages.status, ["queued", "stored", "sent"])));
  }
  return true;
}
