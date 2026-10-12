// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// SMS core (ARCHITECTURE section 13.4, SPEC NT-16, GEN-15): Twilio REST when configured, else the sms_messages log.
// Foundation stub behavior: every message is stored in sms_messages with status 'stored' (log only); idempotent by key.
// Opt-outs, unsupported countries and anti pumping caps are implemented by foundation-platform.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { smsMessages } from "@/db/schema";
import { getEnv } from "../env";
import { log } from "../logger";
import { now } from "../time/now";

export { verifyTwilioSignature } from "./twilio-signature";

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

/** Which transport sends SMS. */
export function smsTransportName(): "twilio" | "outbox" {
  const e = getEnv();
  return e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && (e.TWILIO_FROM_NUMBER || e.TWILIO_MESSAGING_SERVICE_SID)
    ? "twilio"
    : "outbox";
}

/** Sends (stub: logs) one text message. */
export async function sendSms(p: SendSmsInput): Promise<SendSmsResult> {
  const db = await getDb();
  const inserted = await db
    .insert(smsMessages)
    .values({
      organizationId: p.related?.organizationId ?? null,
      toNumber: p.to,
      body: p.body,
      status: "stored",
      provider: "outbox",
      segments: Math.max(1, Math.ceil(p.body.length / 160)),
      idempotencyKey: p.idempotencyKey,
      scheduledEventId: p.related?.scheduledEventId ?? null,
      inviteeId: p.related?.inviteeId ?? null,
      workflowExecutionId: p.related?.workflowExecutionId ?? null,
      sentAt: now(),
    })
    .onConflictDoNothing({ target: smsMessages.idempotencyKey })
    .returning({ id: smsMessages.id });
  if (inserted[0]) {
    log.info("sms.stored", { id: inserted[0].id });
    return { id: inserted[0].id, status: "stored" };
  }
  const [existing] = await db
    .select({ id: smsMessages.id, status: smsMessages.status })
    .from(smsMessages)
    .where(eq(smsMessages.idempotencyKey, p.idempotencyKey))
    .limit(1);
  if (!existing) throw new Error("sendSms: sms row vanished");
  const status = existing.status === "queued" ? "stored" : existing.status;
  return { id: existing.id, status };
}
