// Poll state transitions by hosts (SPEC MP-16, MP-21, MP-22, MP-25; research meeting-polls.md B8, B9): Close voting,
// Reopen voting, Reopen poll (booked -> open, the scheduled meeting kept), Delete poll (soft delete; booked polls keep
// or cancel the meeting), Clear reserved times and Retry holds. Each runs the state machine, writes poll_activity and
// enqueues its side effects in the same transaction. Server only.
import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { meetingPollParticipants, meetingPolls, scheduledEvents } from "@/db/schema";
import type { ActorCtx } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { publishEvent } from "@/lib/events";
import { cancelJobs, runJobsAfterResponse } from "@/lib/jobs";
import { cancelScheduledEvent } from "@/lib/lifecycle";
import { now as clockNow } from "@/lib/time/now";
import { requirePollAccess, requirePollOwner } from "./access";
import { recordActivity } from "./activity";
import { POLL_ERRORS, pollJobGroup } from "./constants";
import { lastOptionStart, loadOptions, lockPoll, statusOf, type PollRow } from "./load";
import { cancelMeetingReminders, cancelPollTimers, cancelReminders, enqueueHoldsSync, enqueuePollEmail, rescheduleReminders, scheduleTimedJobs } from "./schedule";
import { canTransition, isPastDeadline } from "./state";
import { DeletePollSchema, ReopenPollSchema, deadlineProblem } from "./validation";

function transitionError(status: string): AppError {
  if (status === "booked") return new AppError("conflict", POLL_ERRORS.pollBooked);
  if (status === "expired") return new AppError("conflict", POLL_ERRORS.pollEnded);
  return new AppError("conflict", POLL_ERRORS.invalidTransition);
}

/** Emails every respondent (with an email, not unsubscribed) one participant notice. */
async function notifyRespondents(tx: Parameters<typeof lockPoll>[0], poll: PollRow, template: "reopened" | "canceled", actorUserId: string, at: Date): Promise<number> {
  const rows = await tx
    .select({ id: meetingPollParticipants.id, email: meetingPollParticipants.email, status: meetingPollParticipants.status, unsubscribedAt: meetingPollParticipants.unsubscribedAt })
    .from(meetingPollParticipants)
    .where(and(eq(meetingPollParticipants.pollId, poll.id), isNull(meetingPollParticipants.deletedAt), inArray(meetingPollParticipants.status, ["responded", "declined"])));
  let n = 0;
  for (const r of rows) {
    if (!r.email || r.unsubscribedAt) continue;
    await enqueuePollEmail(tx, { template, pollId: poll.id, participantId: r.id, userId: actorUserId }, `${poll.id}:${template}:${r.id}:${at.getTime()}`, at);
    n++;
  }
  return n;
}

/** "Close voting" (open -> closed). */
export async function closeVoting(actor: ActorCtx, pollId: string): Promise<void> {
  const db = await getDb();
  await requirePollAccess(actor, pollId, db);
  const at = clockNow();
  await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, pollId, "update");
    const options = await loadOptions(tx, poll.id);
    const status = statusOf(poll, options, at);
    if (!canTransition(status, "close")) throw transitionError(status);
    const updated = { ...poll, status: "closed" as const };
    await tx.update(meetingPolls).set({ status: "closed", votingClosedAt: at, updatedAt: at }).where(eq(meetingPolls.id, poll.id));
    await recordActivity(tx, { pollId: poll.id, type: "voting_closed", actorUserId: actor.user.id, data: { reason: "host" }, at });
    await cancelReminders(tx, poll.id);
    await scheduleTimedJobs(tx, updated, options, at);
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(pollId)] });
}

/** The deadline after reopening: the given one (validated), else the current one when still in the future. */
function reopenDeadline(poll: PollRow, given: string | null | undefined, lastStart: Date | null, at: Date): Date | null {
  if (given !== undefined) {
    const d = given ? new Date(given) : null;
    const problem = deadlineProblem(d, { now: at, lastOptionStart: lastStart });
    if (problem) throw new AppError("validation", problem, { fieldErrors: { deadline: [problem] } });
    return d;
  }
  if (isPastDeadline(poll.deadlineAt, at)) throw new AppError("validation", POLL_ERRORS.deadlineMoveFirst, { fieldErrors: { deadline: [POLL_ERRORS.deadlineMoveFirst] } });
  return poll.deadlineAt;
}

/** "Reopen voting" (closed -> open); a passed deadline must be moved or cleared first (MP-22). */
export async function reopenVoting(actor: ActorCtx, raw: unknown): Promise<void> {
  const input = ReopenPollSchema.parse(raw);
  const db = await getDb();
  await requirePollAccess(actor, input.pollId, db);
  const at = clockNow();
  await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, input.pollId, "update");
    const options = await loadOptions(tx, poll.id);
    const status = statusOf(poll, options, at);
    if (!canTransition(status, "reopen_voting")) throw transitionError(status);
    const deadlineAt = reopenDeadline(poll, input.deadline, lastOptionStart(options, poll.timezone), at);
    const updated = { ...poll, status: "open" as const, deadlineAt };
    await tx.update(meetingPolls).set({ status: "open", deadlineAt, votingClosedAt: null, updatedAt: at }).where(eq(meetingPolls.id, poll.id));
    await recordActivity(tx, { pollId: poll.id, type: "voting_reopened", actorUserId: actor.user.id, at });
    await scheduleTimedJobs(tx, updated, options, at);
    await rescheduleReminders(tx, updated, options, at);
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
}

/**
 * "Reopen poll" on a booked poll (MP-21): status open, the scheduled meeting untouched; respondents are emailed "{Host}
 * reopened the poll for {title}, you can update your response." unless `notify` is off. Booking again rebooks the same
 * meeting (bookPoll).
 */
export async function reopenPoll(actor: ActorCtx, raw: unknown): Promise<void> {
  const input = ReopenPollSchema.parse(raw);
  const db = await getDb();
  await requirePollAccess(actor, input.pollId, db);
  const at = clockNow();
  await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, input.pollId, "update");
    if (poll.deletedAt) throw new AppError("not_found", POLL_ERRORS.notFound);
    if (!canTransition(poll.status, "reopen")) throw new AppError("conflict", POLL_ERRORS.invalidTransition);
    const options = await loadOptions(tx, poll.id);
    const deadlineAt = reopenDeadline(poll, input.deadline, lastOptionStart(options, poll.timezone), at);
    const updated = { ...poll, status: "open" as const, deadlineAt };
    await tx.update(meetingPolls).set({ status: "open", deadlineAt, votingClosedAt: null, reopenedAt: at, updatedAt: at }).where(eq(meetingPolls.id, poll.id));
    await recordActivity(tx, { pollId: poll.id, type: "reopened", actorUserId: actor.user.id, at });
    await publishEvent(tx, "poll.reopened", { pollId: poll.id }, { organizationId: poll.organizationId, actor: { type: "user", userId: actor.user.id } });
    await scheduleTimedJobs(tx, updated, options, at);
    await rescheduleReminders(tx, updated, options, at);
    if (poll.reserveTimes) await enqueueHoldsSync(tx, poll.id, at);
    if (input.notify) await notifyRespondents(tx, poll, "reopened", actor.user.id, at);
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
}

/**
 * "Delete poll" (MP-22): soft delete (canceled, the link answers 410), purged after 30 days. Only the creator and org
 * owners and admins (a co-host gets 403). A booked (or reopened) poll keeps its meeting unless `cancelMeeting`
 * ("Also cancel the scheduled meeting at {old time}?"). Respondents are emailed unless `notify` is off.
 */
export async function deletePoll(actor: ActorCtx, raw: unknown): Promise<void> {
  const input = DeletePollSchema.parse(raw);
  const db = await getDb();
  const { poll } = await requirePollOwner(actor, input.pollId, db);
  if (input.cancelMeeting && poll.bookedScheduledEventId) {
    const [m] = await db.select({ status: scheduledEvents.status }).from(scheduledEvents).where(eq(scheduledEvents.id, poll.bookedScheduledEventId)).limit(1);
    if (m?.status === "active") {
      await cancelScheduledEvent({ scheduledEventId: poll.bookedScheduledEventId, actor: { type: "user", ctx: actor }, reason: input.reason ?? null, notify: true });
    }
  }
  const at = clockNow();
  await db.transaction(async (tx) => {
    const row = await lockPoll(tx, input.pollId, "update");
    if (row.deletedAt) return;
    const options = await loadOptions(tx, row.id);
    const status = statusOf(row, options, at);
    if (!canTransition(status, "delete")) throw transitionError(status);
    await tx.update(meetingPolls).set({ status: "canceled", canceledAt: at, deletedAt: at, updatedAt: at }).where(eq(meetingPolls.id, row.id));
    await recordActivity(tx, { pollId: row.id, type: "canceled", actorUserId: actor.user.id, data: { cancelMeeting: input.cancelMeeting }, at });
    await publishEvent(tx, "poll.canceled", { pollId: row.id }, { organizationId: row.organizationId, actor: { type: "user", userId: actor.user.id } });
    await cancelPollTimers(tx, row.id);
    if (input.cancelMeeting) await cancelMeetingReminders(tx, row.id);
    // Pending vote notifications and digests of a deleted poll are moot.
    await cancelJobs(tx, { groupKey: pollJobGroup(row.id), type: "polls.notify" });
    await enqueueHoldsSync(tx, row.id, at);
    if (input.notify && status !== "booked") await notifyRespondents(tx, row, "canceled", actor.user.id, at);
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
}

/** "Clear reserved times" (MP-25): turns Reserve times off and removes the holds. */
export async function clearHolds(actor: ActorCtx, pollId: string): Promise<void> {
  const db = await getDb();
  await requirePollAccess(actor, pollId, db);
  const at = clockNow();
  await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, pollId, "update");
    await tx.update(meetingPolls).set({ reserveTimes: false, updatedAt: at }).where(eq(meetingPolls.id, poll.id));
    await recordActivity(tx, { pollId: poll.id, type: "edited", actorUserId: actor.user.id, data: { fields: ["reserveTimes"] }, at });
    await enqueueHoldsSync(tx, poll.id, at);
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(pollId)] });
}

/** "Retry" after "Couldn't reserve {n} times on {Provider}". */
export async function retryHolds(actor: ActorCtx, pollId: string): Promise<void> {
  const db = await getDb();
  await requirePollAccess(actor, pollId, db);
  await enqueueHoldsSync(db, pollId, clockNow());
  runJobsAfterResponse({ groupKeys: [pollJobGroup(pollId)] });
}
