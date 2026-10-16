// Job handlers of meeting polls (ARCHITECTURE 12.2; research meeting-polls.md Part E). Each handler validates its
// payload, re-reads the state and no-ops when no longer applicable (lazy guards make cron latency harmless):
//
//   polls.deadline          deadline reached: open -> closed, host email "Voting closed" (#11)
//   polls.deadline_warning  24 hours before the deadline, when not everyone invited responded: host email (#12)
//   polls.expire            the last option started: open/closed -> expired, holds removed, host email (#13); a
//                           reopened poll that still has its meeting goes back to booked instead
//   polls.reminder          reminders to invited non-respondents (MP-24)
//   polls.digest            hourly: the 08:00 daily digest of hosts on "daily digest" (#4)
//   polls.holds_sync        calendar holds of Reserve times (MP-25)
//   polls.notify            one activity: vote received and new comment emails (#3, #7)
//   polls.notify_subscribers  "others voted" batch, one per 10 minutes (#6)
//   polls.email             one templated email (invitations, confirmations, magic links, notices)
//   polls.auto_book         auto-book on consensus (MP-31)
//   polls.rebook_invitees   invitees added by a rebook, after the lifecycle move job ran (MP-21)
//   polls.meeting_reminder  "Send meeting reminders" emails (MP-18)
//   polls.purge             daily: personal data of polls deleted 30 days ago (MP-22)
//   polls.sweep             hourly backstop: deadlines and expiries whose jobs were lost
import "server-only";
import { and, eq, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import {
  invitees,
  jobs,
  meetingActivity,
  meetingPollActivity,
  meetingPollComments,
  meetingPollOptions,
  meetingPollParticipants,
  meetingPolls,
  scheduledEventHosts,
  scheduledEvents,
  users,
  verificationCodes,
} from "@/db/schema";
import type { QuestionAnswer } from "@/db/types";
import { lockHostsInTx } from "@/lib/booking";
import { publishEvent } from "@/lib/events";
import { PermanentJobError, RetryLaterError, type JobContext, type JobHandlers, type PeriodicJob } from "@/lib/jobs";
import { getT } from "@/lib/i18n";
import { isUuid } from "@/lib/ids";
import { now as clockNow } from "@/lib/time/now";
import { normalizeEmail } from "@/lib/validation";
import { recordActivity } from "./activity";
import { autoBookIfConsensus } from "./book";
import { POLL_JOBS, PURGE_AFTER_DAYS } from "./constants";
import { syncPollHolds } from "./holds";
import { lastOptionStart, loadOptions, loadPoll, lockPoll, statusOf } from "./load";
import { notifyActivity, notifySubscribers, sendAutomaticReminders, sendDigests, sendHostStatus, sendMeetingReminders, sendPollEmail, type PollEmailPayload } from "./notify";
import { cancelPollTimers, cancelReminders, enqueueHoldsSync } from "./schedule";

const DAY = 86_400_000;

function parse<T extends z.ZodType>(schema: T, payload: unknown, type: string): z.output<T> {
  const r = schema.safeParse(payload);
  if (!r.success) throw new PermanentJobError(`${type}: invalid payload`);
  return r.data;
}

const PollPayload = z.object({ pollId: z.uuid() });

// ---------------------------------------------------------------------------------------------------------------
// Deadline, warning, expiry

/** Closes voting at the deadline (job and sweep). Returns true when the poll was closed now. */
export async function closeAtDeadline(db: DB, pollId: string, now: Date): Promise<boolean> {
  const closed = await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, pollId, "update");
    if (poll.deletedAt || poll.status !== "open" || !poll.deadlineAt || poll.deadlineAt.getTime() > now.getTime()) return null;
    const options = await loadOptions(tx, poll.id);
    if (statusOf(poll, options, now) === "expired") return null; // the expiry handles it
    await tx.update(meetingPolls).set({ status: "closed", votingClosedAt: poll.deadlineAt, updatedAt: now }).where(eq(meetingPolls.id, poll.id));
    await recordActivity(tx, { pollId: poll.id, type: "voting_closed", data: { reason: "deadline" }, at: now });
    await cancelReminders(tx, poll.id);
    return poll;
  });
  if (!closed) return false;
  await sendHostStatus(db, closed, "votingClosed", `poll:${closed.id}:voting_closed:${closed.deadlineAt!.getTime()}`);
  return true;
}

/**
 * Expires an open or closed poll whose options all started (job and sweep). A reopened poll whose meeting is still
 * active returns to booked (the meeting stands; nothing "ended"). Returns true when the poll expired now.
 */
export async function expireIfEnded(db: DB, pollId: string, now: Date): Promise<boolean> {
  const expired = await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, pollId, "update");
    if (poll.deletedAt || (poll.status !== "open" && poll.status !== "closed")) return null;
    const options = await loadOptions(tx, poll.id);
    if (statusOf(poll, options, now) !== "expired") return null;
    // A reopened poll whose times all passed without a new booking keeps its meeting: it is booked again, not ended.
    const [kept] = poll.bookedScheduledEventId
      ? await tx
          .select({ id: scheduledEvents.id })
          .from(scheduledEvents)
          .where(and(eq(scheduledEvents.id, poll.bookedScheduledEventId), eq(scheduledEvents.status, "active")))
          .limit(1)
      : [];
    await tx
      .update(meetingPolls)
      .set({ status: kept ? "booked" : "expired", votingClosedAt: poll.votingClosedAt ?? now, updatedAt: now })
      .where(eq(meetingPolls.id, poll.id));
    if (kept) await recordActivity(tx, { pollId: poll.id, type: "voting_closed", data: { reason: "times_passed", scheduledEventId: kept.id }, at: now });
    else await recordActivity(tx, { pollId: poll.id, type: "expired", at: now });
    await cancelPollTimers(tx, poll.id);
    if (poll.reserveTimes) await enqueueHoldsSync(tx, poll.id, now);
    return kept ? null : { poll, last: lastOptionStart(options, poll.timezone) };
  });
  if (!expired) return false;
  await sendHostStatus(db, expired.poll, "ended", `poll:${expired.poll.id}:ended:${expired.last?.getTime() ?? 0}`);
  return true;
}

async function runDeadline(payload: unknown, ctx: JobContext) {
  const p = parse(PollPayload.extend({ deadlineAt: z.iso.datetime() }), payload, POLL_JOBS.deadline);
  const poll = await loadPoll(ctx.db, p.pollId);
  if (!poll || poll.deadlineAt?.toISOString() !== new Date(p.deadlineAt).toISOString()) return { result: { skipped: "moved" } };
  return { result: { closed: await closeAtDeadline(ctx.db, p.pollId, ctx.now) } };
}

async function runDeadlineWarning(payload: unknown, ctx: JobContext) {
  const p = parse(PollPayload.extend({ deadlineAt: z.iso.datetime() }), payload, POLL_JOBS.deadlineWarning);
  const poll = await loadPoll(ctx.db, p.pollId);
  if (!poll || poll.deletedAt || !poll.deadlineAt || poll.deadlineAt.toISOString() !== new Date(p.deadlineAt).toISOString()) return { result: { skipped: "moved" } };
  const options = await loadOptions(ctx.db, poll.id);
  if (statusOf(poll, options, ctx.now) !== "open") return { result: { skipped: "not_open" } };
  const waiting = await ctx.db
    .select({ id: meetingPollParticipants.id })
    .from(meetingPollParticipants)
    .where(and(eq(meetingPollParticipants.pollId, poll.id), eq(meetingPollParticipants.status, "invited"), isNull(meetingPollParticipants.deletedAt)))
    .limit(1);
  if (!waiting.length) return { result: { skipped: "everyone_responded" } };
  return { result: { sent: await sendHostStatus(ctx.db, poll, "deadlineWarning", `poll:${poll.id}:deadline_warning:${poll.deadlineAt.getTime()}`) } };
}

async function runExpire(payload: unknown, ctx: JobContext) {
  const p = parse(PollPayload.extend({ lastStart: z.iso.datetime() }), payload, POLL_JOBS.expire);
  const poll = await loadPoll(ctx.db, p.pollId);
  if (!poll) return { result: { skipped: "missing" } };
  const options = await loadOptions(ctx.db, poll.id);
  const last = lastOptionStart(options, poll.timezone);
  if (last && last.toISOString() !== new Date(p.lastStart).toISOString()) return { result: { skipped: "options_changed" } };
  return { result: { expired: await expireIfEnded(ctx.db, p.pollId, ctx.now) } };
}

// ---------------------------------------------------------------------------------------------------------------
// Rebook: invitees added to the moved meeting (MP-21)

const RebookPayload = PollPayload.extend({
  scheduledEventId: z.uuid(),
  sequence: z.number().int().nullable(),
  invitees: z.array(z.object({ participantId: z.uuid().nullable(), name: z.string(), email: z.string(), timezone: z.string() })).min(1),
  message: z.string().nullable(),
  bookedByUserId: z.uuid(),
});

export async function addRebookInvitees(db: DB, p: z.output<typeof RebookPayload>): Promise<number> {
  if (p.sequence !== null) {
    // Wait for the lifecycle move job ("Updated" emails) so the new people only get their confirmation.
    const [moveJob] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.idempotencyKey, `moved:${p.scheduledEventId}:${p.sequence}`)).limit(1);
    if (moveJob && (moveJob.status === "pending" || moveJob.status === "running")) throw new RetryLaterError(15_000, "waiting for the move notifications");
  }
  const poll = await loadPoll(db, p.pollId);
  if (!poll) return 0;
  const hostRows = await db.select({ userId: scheduledEventHosts.userId }).from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, p.scheduledEventId));
  const added = await db.transaction(async (tx) => {
    await lockHostsInTx(tx, hostRows.map((h) => h.userId));
    const [m] = await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, p.scheduledEventId)).limit(1).for("update");
    if (!m || m.status !== "active") return [] as string[];
    const active = await tx.select().from(invitees).where(and(eq(invitees.scheduledEventId, m.id), eq(invitees.status, "active")));
    const have = new Set(active.map((i) => i.emailNormalized));
    const template = active[0];
    const at = clockNow();
    const [booker] = p.message ? await tx.select({ name: users.name }).from(users).where(eq(users.id, p.bookedByUserId)).limit(1) : [];
    const qa: QuestionAnswer[] = p.message
      ? [{ questionId: null, question: getT(poll.locale, "poll-emails")("common.messageFrom", { hostName: booker?.name ?? "" }).trim(), type: "text", position: 0, answer: p.message }]
      : [];
    const ids: string[] = [];
    for (const person of p.invitees) {
      const key = normalizeEmail(person.email);
      if (have.has(key)) continue;
      have.add(key);
      const [row] = await tx
        .insert(invitees)
        .values({
          scheduledEventId: m.id,
          eventTypeId: m.eventTypeId,
          organizationId: m.organizationId,
          email: person.email,
          emailNormalized: key,
          name: person.name || person.email,
          timezone: person.timezone,
          locale: m.locale,
          status: "active",
          questionsAndAnswers: qa,
          locationAnswer: template?.locationAnswer ?? null,
          pollParticipantId: person.participantId && isUuid(person.participantId) ? person.participantId : null,
          schedulingMethod: "instant_book",
          scheduledByUserId: p.bookedByUserId,
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: invitees.id });
      ids.push(row!.id);
      await tx.insert(meetingActivity).values({ scheduledEventId: m.id, inviteeId: row!.id, type: "invitee_added", actorType: "user", actorUserId: p.bookedByUserId, data: { source: "poll" } });
    }
    if (!ids.length) return ids;
    await tx.update(scheduledEvents).set({ inviteesLimit: Math.max(m.inviteesLimit, active.length + ids.length), updatedAt: at }).where(eq(scheduledEvents.id, m.id));
    for (const inviteeId of ids) {
      await publishEvent(tx, "booking.created", { scheduledEventId: m.id, inviteeId, source: "poll" }, { organizationId: m.organizationId, actor: { type: "user", userId: p.bookedByUserId } });
    }
    return ids;
  });
  return added.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Purge and sweep

/**
 * Hard-deletes the personal data of polls deleted more than 30 days ago (activity kept without names). Only polls that
 * still hold personal data are picked, so a batch never re-selects already purged polls and every poll gets its turn.
 */
export async function purgeDeletedPolls(db: DB, now: Date, opts: { batch?: number } = {}): Promise<number> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * DAY);
  const hasPersonalData = sql`(
    exists (select 1 from ${meetingPollParticipants} where ${meetingPollParticipants.pollId} = ${meetingPolls.id})
    or exists (select 1 from ${meetingPollComments} where ${meetingPollComments.pollId} = ${meetingPolls.id})
    or exists (
      select 1 from ${meetingPollActivity}
      where ${meetingPollActivity.pollId} = ${meetingPolls.id}
        and (${meetingPollActivity.participantId} is not null or (${meetingPollActivity.data} -> 'name') is not null or (${meetingPollActivity.data} -> 'participantIds') is not null)
    )
  )`;
  const rows = await db
    .select({ id: meetingPolls.id })
    .from(meetingPolls)
    .where(and(isNotNull(meetingPolls.deletedAt), lt(meetingPolls.deletedAt, cutoff), hasPersonalData))
    .orderBy(meetingPolls.deletedAt)
    .limit(Math.max(1, opts.batch ?? 200));
  let purged = 0;
  for (const { id } of rows) {
    const had = await db.transaction(async (tx) => {
      const parts = await tx.delete(meetingPollParticipants).where(eq(meetingPollParticipants.pollId, id)).returning({ id: meetingPollParticipants.id });
      const comments = await tx.delete(meetingPollComments).where(eq(meetingPollComments.pollId, id)).returning({ id: meetingPollComments.id });
      await tx.delete(verificationCodes).where(and(eq(verificationCodes.purpose, "poll_vote"), eq(verificationCodes.contextId, id)));
      const acts = await tx.select({ id: meetingPollActivity.id, data: meetingPollActivity.data }).from(meetingPollActivity).where(eq(meetingPollActivity.pollId, id));
      for (const a of acts) {
        if (!("name" in a.data) && !("participantIds" in a.data)) continue;
        const { name: _n, participantIds: _p, ...rest } = a.data as Record<string, unknown>;
        void _n;
        void _p;
        await tx.update(meetingPollActivity).set({ data: rest, participantId: null }).where(eq(meetingPollActivity.id, a.id));
      }
      await tx.update(meetingPollActivity).set({ participantId: null }).where(eq(meetingPollActivity.pollId, id));
      return parts.length + comments.length + acts.length;
    });
    if (had) purged++;
  }
  return purged;
}

/**
 * Backstop for lost timed jobs: closes past deadlines and expires ended polls. Only polls that may need it are picked
 * (open past their deadline, or without a time that surely lies ahead), so healthy polls never crowd out the rest.
 */
export async function sweepPolls(db: DB, now: Date): Promise<{ closed: number; expired: number }> {
  // A date-only option surely starts after now when its date is two days ahead (local midnight in any zone).
  const futureDate = new Date(now.getTime() + 2 * DAY).toISOString().slice(0, 10);
  const candidates = await db
    .select({ id: meetingPolls.id, status: meetingPolls.status, deadlineAt: meetingPolls.deadlineAt })
    .from(meetingPolls)
    .where(
      and(
        isNull(meetingPolls.deletedAt),
        or(eq(meetingPolls.status, "open"), eq(meetingPolls.status, "closed")),
        or(
          and(eq(meetingPolls.status, "open"), isNotNull(meetingPolls.deadlineAt), lte(meetingPolls.deadlineAt, now)),
          sql`not exists (
            select 1 from ${meetingPollOptions}
            where ${meetingPollOptions.pollId} = ${meetingPolls.id}
              and ${meetingPollOptions.deletedAt} is null
              and (${meetingPollOptions.startsAt} > ${now.toISOString()}::timestamptz or ${meetingPollOptions.allDayDate} > ${futureDate}::date)
          )`,
        ),
      ),
    )
    .orderBy(meetingPolls.updatedAt)
    .limit(500);
  let closed = 0;
  let expired = 0;
  for (const c of candidates) {
    if (await expireIfEnded(db, c.id, now)) {
      expired++;
      continue;
    }
    if (c.status === "open" && c.deadlineAt && c.deadlineAt.getTime() <= now.getTime() && (await closeAtDeadline(db, c.id, now))) closed++;
  }
  return { closed, expired };
}

// ---------------------------------------------------------------------------------------------------------------
// Registry

const ReminderPayload = PollPayload.extend({ kind: z.enum(["anchor", "after_invite"]), index: z.number().int().min(0), participantIds: z.array(z.uuid()).optional() });
const NotifyPayload = PollPayload.extend({ activityId: z.uuid() });
const SubscribersPayload = PollPayload.extend({ from: z.iso.datetime(), to: z.iso.datetime() });
const EmailPayload = z.object({
  template: z.string().min(1).max(64),
  pollId: z.uuid(),
  participantId: z.uuid().nullish(),
  userId: z.uuid().nullish(),
  email: z.string().max(254).nullish(),
  data: z.record(z.string(), z.unknown()).optional(),
  key: z.string().min(1).max(300),
});
const MeetingReminderPayload = PollPayload.extend({ scheduledEventId: z.uuid(), start: z.iso.datetime(), minutes: z.number().int() });

export const pollJobHandlers: JobHandlers = {
  [POLL_JOBS.deadline]: runDeadline,
  [POLL_JOBS.deadlineWarning]: runDeadlineWarning,
  [POLL_JOBS.expire]: runExpire,
  [POLL_JOBS.reminder]: async (payload, ctx) => {
    const p = parse(ReminderPayload, payload, POLL_JOBS.reminder);
    return { result: { sent: await sendAutomaticReminders(ctx.db, p.pollId, { kind: p.kind, index: p.index, participantIds: p.participantIds }) } };
  },
  [POLL_JOBS.digest]: async (_payload, ctx) => ({ result: { sent: await sendDigests(ctx.db, ctx.now) } }),
  [POLL_JOBS.holdsSync]: async (payload, ctx) => {
    const p = parse(PollPayload.extend({ refresh: z.boolean().optional() }), payload, POLL_JOBS.holdsSync);
    const out = await syncPollHolds(p.pollId, { refresh: p.refresh ?? false });
    if (out.pending > 0 && ctx.attempt < 6) throw new RetryLaterError(5 * 60_000, `${out.pending} holds pending`);
    return { result: out };
  },
  [POLL_JOBS.notify]: async (payload, ctx) => {
    const p = parse(NotifyPayload, payload, POLL_JOBS.notify);
    return { result: { sent: await notifyActivity(ctx.db, p.pollId, p.activityId) } };
  },
  [POLL_JOBS.notifySubscribers]: async (payload, ctx) => {
    const p = parse(SubscribersPayload, payload, POLL_JOBS.notifySubscribers);
    return { result: { sent: await notifySubscribers(ctx.db, p.pollId, new Date(p.from), new Date(p.to)) } };
  },
  [POLL_JOBS.email]: async (payload, ctx) => {
    const p = parse(EmailPayload, payload, POLL_JOBS.email) as PollEmailPayload;
    return { result: { sent: await sendPollEmail(ctx.db, p) } };
  },
  [POLL_JOBS.autoBook]: async (payload) => {
    const p = parse(PollPayload, payload, POLL_JOBS.autoBook);
    return { result: await autoBookIfConsensus(p.pollId) };
  },
  [POLL_JOBS.rebookInvitees]: async (payload, ctx) => {
    const p = parse(RebookPayload, payload, POLL_JOBS.rebookInvitees);
    return { result: { added: await addRebookInvitees(ctx.db, p) } };
  },
  [POLL_JOBS.meetingReminder]: async (payload, ctx) => {
    const p = parse(MeetingReminderPayload, payload, POLL_JOBS.meetingReminder);
    return { result: { sent: await sendMeetingReminders(ctx.db, p) } };
  },
  [POLL_JOBS.purge]: async (_payload, ctx) => ({ result: { purged: await purgeDeletedPolls(ctx.db, ctx.now) } }),
  [POLL_JOBS.sweep]: async (_payload, ctx) => ({ result: await sweepPolls(ctx.db, ctx.now) }),
};

export const pollPeriodicJobs: PeriodicJob[] = [
  { type: POLL_JOBS.digest, everyMinutes: 60 },
  { type: POLL_JOBS.sweep, everyMinutes: 60 },
  { type: POLL_JOBS.purge, everyMinutes: 1440 },
];

