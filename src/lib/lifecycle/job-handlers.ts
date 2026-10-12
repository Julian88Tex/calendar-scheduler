// Job handlers of the lifecycle module (ARCHITECTURE 12.2), re-exported by the contract file jobs.ts:
//
//   lifecycle.provision_retry             { scheduledEventId, op: "calendar" | "conference" }: a calendar write that
//                                         failed (CAL-12 fallback after 3 attempts) or a Meet link still being created
//   lifecycle.meeting_moved               { scheduledEventId, fromStart, fromEnd, sequence }: in-place move side effects
//   lifecycle.request_reschedule_reminder { inviteeId, days }: CR-08 reminder unless the invitee booked again
//   lifecycle.cancel_user_meetings        { userId, scope: "sole_host" | "all_hosted", reason }: AU-15 / TM-04, the
//                                         user's upcoming meetings canceled with the standard emails, in batches
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import { enqueueJob, PermanentJobError, type JobContext, type JobHandlers } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { cancelMeeting } from "./cancel";
import { futureMeetingsOf } from "./host-actions";
import { notifyMeeting, notifyMoved, sendConferenceFailure, sendRequestRescheduleReminder } from "./notify";
import { checkPendingConference } from "./provision";
import { provisionAndNotify } from "./subscriber-handlers";
import { JOB_TYPES } from "./types";

const ProvisionPayload = z.object({ scheduledEventId: z.uuid(), op: z.enum(["calendar", "conference"]).default("calendar") });
const MovedPayload = z.object({ scheduledEventId: z.uuid(), fromStart: z.string(), fromEnd: z.string(), sequence: z.number().int().min(0) });
const ReminderPayload = z.object({ inviteeId: z.uuid(), days: z.number().int().min(1).max(30) });
const CancelUserPayload = z.object({
  userId: z.uuid(),
  scope: z.enum(["sole_host", "all_hosted"]).default("sole_host"),
  reason: z.string().max(2000).nullish(),
  /** Batch number (re-enqueued until done). */
  batch: z.number().int().min(0).default(0),
});

const CANCEL_BATCH = 25;
const CANCEL_BUDGET_MS = 15_000;
const MAX_BATCHES = 400;

function parse<T>(schema: z.ZodType<T>, payload: unknown, type: string): T {
  const r = schema.safeParse(payload);
  if (!r.success) throw new PermanentJobError(`Malformed ${type} payload`);
  return r.data;
}

export async function runProvisionRetry(payload: unknown, ctx: JobContext): Promise<{ result: unknown }> {
  const p = parse(ProvisionPayload, payload, JOB_TYPES.provisionRetry);
  if (p.op === "conference") {
    const r = await checkPendingConference(ctx.db, p.scheduledEventId);
    if (r.conference === "failed") await sendConferenceFailure(ctx.db, p.scheduledEventId);
    if (r.ready) await notifyMeeting(ctx.db, p.scheduledEventId);
    return { result: r };
  }
  const out = await provisionAndNotify(ctx.db, p.scheduledEventId);
  return { result: out };
}

export async function runMeetingMoved(payload: unknown, ctx: JobContext): Promise<{ result: unknown }> {
  const p = parse(MovedPayload, payload, JOB_TYPES.meetingMoved);
  const out = await provisionAndNotify(ctx.db, p.scheduledEventId, {}, { inviteeIds: [] });
  if (out.active) await notifyMoved(ctx.db, { scheduledEventId: p.scheduledEventId, fromStart: new Date(p.fromStart), fromEnd: new Date(p.fromEnd), sequence: p.sequence });
  return { result: out };
}

export async function runRequestRescheduleReminder(payload: unknown, ctx: JobContext): Promise<{ result: unknown }> {
  const p = parse(ReminderPayload, payload, JOB_TYPES.requestRescheduleReminder);
  return { result: await sendRequestRescheduleReminder(ctx.db, p.inviteeId, p.days) };
}

export async function runCancelUserMeetings(payload: unknown, ctx: JobContext): Promise<{ result: unknown }> {
  const p = parse(CancelUserPayload, payload, JOB_TYPES.cancelUserMeetings);
  const started = performance.now();
  const [user] = await ctx.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, p.userId)).limit(1);
  const ids = await futureMeetingsOf(p.userId, p.scope, now(), CANCEL_BATCH);
  let canceled = 0;
  let outOfTime = false;
  for (const id of ids) {
    if (performance.now() - started > CANCEL_BUDGET_MS) {
      outOfTime = true;
      break;
    }
    try {
      await cancelMeeting({
        scheduledEventId: id,
        actor: { type: "system", name: user?.name ?? null },
        reason: p.reason?.trim() || null,
        kind: "account",
        canceler: { type: "host", userId: user?.id ?? null, name: user?.name ?? null },
      });
      canceled++;
    } catch (e) {
      log.warn("lifecycle.cancel_user_meeting_failed", { scheduledEventId: id, error: e });
    }
  }
  // More to do: a full batch that made progress, or the time budget ran out (a meeting that keeps failing is logged
  // and does not loop forever).
  if (p.batch < MAX_BATCHES && (outOfTime || (ids.length >= CANCEL_BATCH && canceled > 0))) {
    await enqueueJob(ctx.db, {
      type: JOB_TYPES.cancelUserMeetings,
      payload: { ...p, batch: p.batch + 1 },
      idempotencyKey: `cancel-user-meetings:${p.userId}:${p.scope}:${ctx.jobId}:${p.batch + 1}`,
    });
  }
  return { result: { canceled, batch: p.batch } };
}

export const lifecycleJobHandlers: JobHandlers = {
  [JOB_TYPES.provisionRetry]: (payload, ctx) => runProvisionRetry(payload, ctx),
  [JOB_TYPES.meetingMoved]: (payload, ctx) => runMeetingMoved(payload, ctx),
  [JOB_TYPES.requestRescheduleReminder]: (payload, ctx) => runRequestRescheduleReminder(payload, ctx),
  [JOB_TYPES.cancelUserMeetings]: (payload, ctx) => runCancelUserMeetings(payload, ctx),
};
