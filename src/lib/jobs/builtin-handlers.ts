// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Foundation job handlers (ARCHITECTURE section 12.2): email.retry, sms.retry and system.cleanup.
//
// - email.retry { outboxId, headers? }: one more delivery attempt of an outbox row; throws on a retryable failure so
//   the runner backs off (30s doubling, 8 attempts in total with the inline one); while another worker is still
//   delivering the row it retries later without counting an attempt. Without an outboxId (the periodic run every 15
//   minutes) it sweeps rows interrupted mid-delivery and failed rows whose retry job was lost.
// - sms.retry { smsId }: the same for the SMS log.
// - system.cleanup (daily): the GEN-16 retention rules (src/lib/jobs/cleanup.ts); continues in a follow-up job when
//   one run is not enough.
// - files.delete_blob { url }: deletes a Vercel Blob after the transaction that deleted its files row committed
//   (deleteFile in src/lib/files.ts); throws on a failure so the runner retries with backoff.
import "server-only";
import { EMAIL_STALE_SENDING_MS, cleanHeaders, retryEmailDelivery, sweepStuckEmails } from "../email/send";
import { deleteBlobNow } from "../files";
import { SMS_STALE_QUEUED_MS, retrySmsDelivery, sweepStuckSms } from "../sms/send";
import { runRetentionCleanup } from "./cleanup";
import { enqueueJob } from "./queue";
import { RetryLaterError, type JobHandlers, type PeriodicJob } from "./types";

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

export const builtinHandlers: JobHandlers = {
  "email.retry": async (payload: { outboxId?: unknown; headers?: unknown }) => {
    if (!isId(payload?.outboxId)) {
      const swept = await sweepStuckEmails();
      return { result: { swept } };
    }
    const outcome = await retryEmailDelivery(payload.outboxId, cleanHeaders(payload.headers));
    if (outcome === "retry") throw new Error("Email delivery failed; retrying with backoff");
    // Another worker is delivering it (or was killed doing so): look again once that delivery counts as interrupted.
    if (outcome === "in_flight") throw new RetryLaterError(EMAIL_STALE_SENDING_MS + 60_000, "Email delivery in progress elsewhere");
    return { result: { outcome } };
  },
  "sms.retry": async (payload: { smsId?: unknown }) => {
    if (!isId(payload?.smsId)) {
      const swept = await sweepStuckSms();
      return { result: { swept } };
    }
    const outcome = await retrySmsDelivery(payload.smsId);
    if (outcome === "retry") throw new Error("SMS delivery failed; retrying with backoff");
    if (outcome === "in_flight") throw new RetryLaterError(SMS_STALE_QUEUED_MS + 60_000, "SMS delivery in progress elsewhere");
    return { result: { outcome } };
  },
  // The type literal matches DELETE_BLOB_JOB in src/lib/files.ts (not imported as a value: files.ts and the job
  // registry import each other through the cleanup rules).
  "files.delete_blob": async (payload: { url?: unknown }) => {
    const url = payload?.url;
    if (typeof url !== "string" || !url.startsWith("https://")) return { result: { skipped: "no_url" } };
    await deleteBlobNow(url);
    return { result: { deleted: true } };
  },
  "system.cleanup": async (_payload, ctx) => {
    const { counts, complete } = await runRetentionCleanup(ctx.db, ctx.now, { budgetMs: 20_000 });
    if (!complete) {
      await enqueueJob(ctx.db, { type: "system.cleanup", idempotencyKey: `system.cleanup:continue:${ctx.jobId}` });
    }
    ctx.log.info("system.cleanup", { counts, complete });
    return { result: { counts, complete } };
  },
};

export const builtinPeriodic: PeriodicJob[] = [
  { type: "system.cleanup", everyMinutes: 24 * 60 },
  { type: "email.retry", everyMinutes: 15 },
  { type: "sms.retry", everyMinutes: 15 },
];
