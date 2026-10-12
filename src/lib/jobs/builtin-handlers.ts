// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Foundation job handlers (ARCHITECTURE section 12.2): email.retry, sms.retry and system.cleanup.
//
// - email.retry { outboxId, headers? }: one more delivery attempt of an outbox row; throws on a retryable failure so
//   the runner backs off (30s doubling, 8 attempts in total with the inline one). Without an outboxId (the periodic
//   run every 15 minutes) it sweeps rows interrupted mid-delivery.
// - sms.retry { smsId }: the same for the SMS log.
// - system.cleanup (daily): the GEN-16 retention rules (src/lib/jobs/cleanup.ts); continues in a follow-up job when
//   one run is not enough.
import "server-only";
import { retryEmailDelivery, sweepStuckEmails } from "../email/send";
import { retrySmsDelivery, sweepStuckSms } from "../sms/send";
import { runRetentionCleanup } from "./cleanup";
import { enqueueJob } from "./queue";
import type { JobHandlers, PeriodicJob } from "./types";

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

export const builtinHandlers: JobHandlers = {
  "email.retry": async (payload: { outboxId?: unknown; headers?: unknown }) => {
    if (!isId(payload?.outboxId)) {
      const swept = await sweepStuckEmails();
      return { result: { swept } };
    }
    const headers =
      payload.headers && typeof payload.headers === "object" && !Array.isArray(payload.headers)
        ? Object.fromEntries(
            Object.entries(payload.headers as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === "string" && /^[A-Za-z0-9-]+$/.test(e[0]),
            ),
          )
        : {};
    const outcome = await retryEmailDelivery(payload.outboxId, headers);
    if (outcome === "retry") throw new Error("Email delivery failed; retrying with backoff");
    return { result: { outcome } };
  },
  "sms.retry": async (payload: { smsId?: unknown }) => {
    if (!isId(payload?.smsId)) {
      const swept = await sweepStuckSms();
      return { result: { swept } };
    }
    const outcome = await retrySmsDelivery(payload.smsId);
    if (outcome === "retry") throw new Error("SMS delivery failed; retrying with backoff");
    return { result: { outcome } };
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
