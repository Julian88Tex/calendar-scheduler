// Timed and side-effect jobs of polls (SPEC MP-22, MP-23, MP-24, MP-25; research meeting-polls.md Part E). Every
// helper runs inside the caller's transaction (outbox pattern) and is idempotent: timed jobs are keyed by their due
// time and revived when a key comes back (enqueueOrReviveJob), and reschedules cancel the pending ones first. Handlers
// re-read the state and no-op when no longer applicable, so cron latency never affects correctness. Server only.
import "server-only";
import type { DbOrTx } from "@/db";
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
  await cancelJobs(tx, { groupKey: group, type: POLL_JOBS.reminder });
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
  for (const r of plan) {
    await enqueueJob(tx, {
      type: POLL_JOBS.reminder,
      payload: { pollId: poll.id, kind: "after_invite", index: r.index, participantIds: batch.participantIds },
      runAt: r.runAt,
      groupKey: inviteReminderGroup(poll.id),
      idempotencyKey: `poll:${poll.id}:reminder:invite:${r.index}:${batch.invitedAt.getTime()}:${batch.participantIds[0]}`,
    });
  }
  return plan.length;
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

/** Brings the calendar holds in line with the poll (Reserve times, MP-25). */
export async function enqueueHoldsSync(tx: DbOrTx, pollId: string, now: Date): Promise<void> {
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
    payload: job,
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
