// Timed and side-effect jobs of polls (SPEC MP-22, MP-23, MP-24, MP-25; research meeting-polls.md Part E). Every
// helper runs inside the caller's transaction (outbox pattern) and is idempotent: timed jobs are keyed by their due
// time and revived when a key comes back (enqueueOrReviveJob), and reschedules cancel the pending ones first. Handlers
// re-read the state and no-op when no longer applicable, so cron latency never affects correctness. Server only.
import "server-only";
import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { jobs, meetingPollParticipants } from "@/db/schema";
import { cancelJobs, enqueueJob, enqueueOrReviveJob } from "@/lib/jobs";
import { DEADLINE_WARNING_MS, MEETING_REMINDER_OFFSETS_MINUTES, POLL_JOBS, SUBSCRIBER_BATCH_MS, pollJobGroup } from "./constants";
import { firstFutureOptionStart, lastOptionStart, type OptionRow, type PollRow } from "./load";
import { planAnchorReminders, planInviteReminders } from "./reminders";

export const anchorReminderGroup = (pollId: string) => `poll:${pollId}:anchor-reminders`;
export const inviteReminderGroup = (pollId: string) => `poll:${pollId}:invite-reminders`;
export const meetingReminderGroup = (pollId: string) => `poll:${pollId}:meeting-reminders`;

type PollTimes = Pick<PollRow, "id" | "status" | "deadlineAt" | "timezone" | "reminderMode" | "reminderOffsets" | "firstInviteSentAt">;

/** Deadline, deadline warning and expiry jobs for the poll's current state (cancels the pending ones first). */
export async function scheduleTimedJobs(tx: DbOrTx, poll: PollTimes, options: readonly OptionRow[], now: Date): Promise<void> {
  const group = pollJobGroup(poll.id);
  for (const type of [POLL_JOBS.deadline, POLL_JOBS.deadlineWarning, POLL_JOBS.expire]) await cancelJobs(tx, { groupKey: group, type });
  if (poll.status !== "open" && poll.status !== "closed") return;
  if (poll.status === "open" && poll.deadlineAt) {
    const at = poll.deadlineAt;
    await enqueueOrReviveJob(tx, {
      type: POLL_JOBS.deadline,
      payload: { pollId: poll.id, deadlineAt: at.toISOString() },
      runAt: at,
      groupKey: group,
      idempotencyKey: `poll:${poll.id}:deadline:${at.getTime()}`,
    });
    const warnAt = new Date(at.getTime() - DEADLINE_WARNING_MS);
    if (warnAt.getTime() > now.getTime()) {
      await enqueueOrReviveJob(tx, {
        type: POLL_JOBS.deadlineWarning,
        payload: { pollId: poll.id, deadlineAt: at.toISOString() },
        runAt: warnAt,
        groupKey: group,
        idempotencyKey: `poll:${poll.id}:deadline_warning:${at.getTime()}`,
      });
    }
  }
  const last = lastOptionStart(options, poll.timezone);
  if (last) {
    await enqueueOrReviveJob(tx, {
      type: POLL_JOBS.expire,
      payload: { pollId: poll.id, lastStart: last.toISOString() },
      runAt: last,
      groupKey: group,
      idempotencyKey: `poll:${poll.id}:expire:${last.getTime()}`,
    });
  }
}

/** Anchor based reminders (smart 48 or 36 hours before the anchor, custom before the deadline), recomputed. */
export async function scheduleAnchorReminders(tx: DbOrTx, poll: PollTimes, options: readonly OptionRow[], now: Date): Promise<number> {
  const group = anchorReminderGroup(poll.id);
  await cancelFutureReminders(tx, [group], now);
  if (poll.status !== "open") return 0;
  const plan = planAnchorReminders({
    mode: poll.reminderMode,
    offsets: poll.reminderOffsets,
    deadlineAt: poll.deadlineAt,
    firstFutureOptionStart: firstFutureOptionStart(options, poll.timezone, now),
    lastOptionStart: lastOptionStart(options, poll.timezone),
    firstInviteSentAt: poll.firstInviteSentAt,
    now,
  });
  for (const r of plan) {
    await enqueueOrReviveJob(tx, {
      type: POLL_JOBS.reminder,
      payload: { pollId: poll.id, kind: "anchor", index: r.index },
      runAt: r.runAt,
      groupKey: group,
      idempotencyKey: `poll:${poll.id}:reminder:anchor:${r.index}:${r.runAt.getTime()}`,
    });
  }
  return plan.length;
}

/** After-invitation reminders of one batch of invited participants (smart early nudge, custom after the invitation). */
export async function scheduleInviteReminders(
  tx: DbOrTx,
  poll: PollTimes,
  options: readonly OptionRow[],
  batch: { invitedAt: Date; participantIds: string[] },
  now: Date,
): Promise<number> {
  if (poll.status !== "open" || !batch.participantIds.length) return 0;
  const plan = planInviteReminders({
    mode: poll.reminderMode,
    offsets: poll.reminderOffsets,
    deadlineAt: poll.deadlineAt,
    firstFutureOptionStart: firstFutureOptionStart(options, poll.timezone, now),
    lastOptionStart: lastOptionStart(options, poll.timezone),
    invitedAt: batch.invitedAt,
    now,
  });
  const ids = [...batch.participantIds].sort();
  for (const r of plan) {
    // Keyed by the batch and the due time: a recompute revives a canceled reminder instead of losing it, and a moved
    // reminder (another due time) is a new job.
    await enqueueOrReviveJob(tx, {
      type: POLL_JOBS.reminder,
      payload: { pollId: poll.id, kind: "after_invite", index: r.index, participantIds: ids },
      runAt: r.runAt,
      groupKey: inviteReminderGroup(poll.id),
      idempotencyKey: `poll:${poll.id}:reminder:invite:${r.index}:${batch.invitedAt.getTime()}:${r.runAt.getTime()}:${ids[0]}`,
    });
  }
  return plan.length;
}

/**
 * Recomputes every automatic reminder of a poll (MP-24: "Jobs are recomputed when deadline, options or invites
 * change"): the anchor reminders, and the after-invitation reminders of every batch of invited people who have not
 * responded (grouped by their invitation time). Pending reminders are canceled first; nothing is planned unless the
 * poll is open. The send-time checks (still open, still invited, subscribed, at most 3) stay in the job.
 */
export async function rescheduleReminders(tx: DbOrTx, poll: PollTimes, options: readonly OptionRow[], now: Date): Promise<number> {
  await cancelFutureReminders(tx, [anchorReminderGroup(poll.id), inviteReminderGroup(poll.id)], now);
  if (poll.status !== "open") return 0;
  let planned = await scheduleAnchorReminders(tx, poll, options, now);
  if (poll.reminderMode === "off") return planned;
  const rows = await tx
    .select({ id: meetingPollParticipants.id, invitedAt: meetingPollParticipants.invitedAt })
    .from(meetingPollParticipants)
    .where(
      and(
        eq(meetingPollParticipants.pollId, poll.id),
        eq(meetingPollParticipants.status, "invited"),
        isNull(meetingPollParticipants.deletedAt),
        isNull(meetingPollParticipants.unsubscribedAt),
        isNotNull(meetingPollParticipants.invitedAt),
      ),
    );
  const batches = new Map<number, string[]>();
  for (const r of rows) {
    const key = r.invitedAt!.getTime();
    batches.set(key, [...(batches.get(key) ?? []), r.id]);
  }
  for (const [invitedAt, participantIds] of batches) {
    planned += await scheduleInviteReminders(tx, poll, options, { invitedAt: new Date(invitedAt), participantIds }, now);
  }
  return planned;
}

/**
 * Cancels the pending reminders of these groups that are not due yet. Reminders already due (waiting for the next cron
 * run) stay: a recompute only plans future ones, and the job re-checks eligibility when it runs.
 */
async function cancelFutureReminders(tx: DbOrTx, groups: string[], now: Date): Promise<void> {
  const rows = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(inArray(jobs.groupKey, groups), eq(jobs.type, POLL_JOBS.reminder), eq(jobs.status, "pending"), gt(jobs.runAt, now)));
  if (rows.length) await cancelJobs(tx, { ids: rows.map((r) => r.id) });
}

/** Cancels every pending reminder (booked, closed, canceled or expired polls). */
export async function cancelReminders(tx: DbOrTx, pollId: string): Promise<void> {
  await cancelJobs(tx, { groupKey: anchorReminderGroup(pollId), type: POLL_JOBS.reminder });
  await cancelJobs(tx, { groupKey: inviteReminderGroup(pollId), type: POLL_JOBS.reminder });
}

/** Cancels the timed jobs and reminders of a poll that stopped collecting votes for good. */
export async function cancelPollTimers(tx: DbOrTx, pollId: string): Promise<void> {
  const group = pollJobGroup(pollId);
  for (const type of [POLL_JOBS.deadline, POLL_JOBS.deadlineWarning, POLL_JOBS.expire]) await cancelJobs(tx, { groupKey: group, type });
  await cancelReminders(tx, pollId);
}

/**
 * Brings the calendar holds in line with the poll (Reserve times, MP-25). `refresh` also rewrites the holds that are
 * already on the calendars (the poll title changed), as its own job so a pending plain sync never swallows it.
 */
export async function enqueueHoldsSync(tx: DbOrTx, pollId: string, now: Date, opts: { refresh?: boolean } = {}): Promise<void> {
  if (opts.refresh) {
    await enqueueJob(tx, {
      type: POLL_JOBS.holdsSync,
      payload: { pollId, refresh: true },
      runAt: now,
      groupKey: pollJobGroup(pollId),
      idempotencyKey: `poll:${pollId}:holds:refresh:${now.getTime()}`,
      priority: 5,
    });
    return;
  }
  await enqueueOrReviveJob(tx, {
    type: POLL_JOBS.holdsSync,
    payload: { pollId },
    runAt: now,
    groupKey: pollJobGroup(pollId),
    idempotencyKey: `poll:${pollId}:holds`,
    priority: 5,
  });
}

/** Immediate host notification of one activity (vote received, new comment; MP-23). */
export async function enqueueNotify(tx: DbOrTx, pollId: string, activityId: string, now: Date): Promise<void> {
  await enqueueJob(tx, {
    type: POLL_JOBS.notify,
    payload: { pollId, activityId },
    runAt: now,
    groupKey: pollJobGroup(pollId),
    idempotencyKey: `poll:${pollId}:notify:${activityId}`,
    priority: 5,
  });
}

/** "Others voted" batch: at most one email per subscribed voter per 10 minutes (the job runs at the window end). */
export async function enqueueSubscriberBatch(tx: DbOrTx, pollId: string, now: Date): Promise<void> {
  const bucket = Math.floor(now.getTime() / SUBSCRIBER_BATCH_MS);
  const runAt = new Date((bucket + 1) * SUBSCRIBER_BATCH_MS);
  await enqueueJob(tx, {
    type: POLL_JOBS.notifySubscribers,
    payload: { pollId, from: new Date(bucket * SUBSCRIBER_BATCH_MS).toISOString(), to: runAt.toISOString() },
    runAt,
    groupKey: pollJobGroup(pollId),
    idempotencyKey: `poll:${pollId}:subscribers:${bucket}`,
  });
}

export type PollEmailJob = {
  /** Template id (notify.ts sendPollEmail). */
  template: string;
  pollId: string;
  participantId?: string | null;
  userId?: string | null;
  email?: string | null;
  data?: Record<string, unknown>;
};

/** One templated email rendered at send time (fresh names, times and links). */
export async function enqueuePollEmail(tx: DbOrTx, job: PollEmailJob, key: string, now: Date, priority = 5): Promise<void> {
  await enqueueJob(tx, {
    type: POLL_JOBS.email,
    payload: { ...job, key },
    runAt: now,
    groupKey: pollJobGroup(job.pollId),
    idempotencyKey: `poll-email:${key}`,
    priority,
    maxAttempts: 6,
  });
}

/** Meeting reminders of a booked poll ("Send meeting reminders": 24 hours and 1 hour before, MP-18). */
export async function scheduleMeetingReminders(tx: DbOrTx, pollId: string, scheduledEventId: string, start: Date, now: Date): Promise<void> {
  await cancelJobs(tx, { groupKey: meetingReminderGroup(pollId), type: POLL_JOBS.meetingReminder });
  for (const minutes of MEETING_REMINDER_OFFSETS_MINUTES) {
    const runAt = new Date(start.getTime() - minutes * 60_000);
    if (runAt.getTime() <= now.getTime()) continue;
    await enqueueOrReviveJob(tx, {
      type: POLL_JOBS.meetingReminder,
      payload: { pollId, scheduledEventId, start: start.toISOString(), minutes },
      runAt,
      groupKey: meetingReminderGroup(pollId),
      idempotencyKey: `poll:${pollId}:meeting-reminder:${scheduledEventId}:${start.getTime()}:${minutes}`,
    });
  }
}

export async function cancelMeetingReminders(tx: DbOrTx, pollId: string): Promise<void> {
  await cancelJobs(tx, { groupKey: meetingReminderGroup(pollId), type: POLL_JOBS.meetingReminder });
}
