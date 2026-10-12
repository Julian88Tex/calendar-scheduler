// markPollBookedInTx (ARCHITECTURE section 25; SPEC MP-19): lock order step 2 of booking-core's createBooking for poll
// bookings. Runs inside the booking transaction after the hosts' advisory locks: locks the poll row FOR UPDATE,
// re-validates (not deleted, effective status open or closed, the option live and in the future, no other active
// meeting), marks the poll booked and, in the same transaction (outbox), records the activity, publishes poll.booked
// and enqueues the side effects: holds removal, cancel of the deadline, expiry and reminder jobs, optional meeting
// reminders, optional "The time has been chosen" emails and the auto-book host email. Throwing AppError("conflict")
// rolls the booking back (booking-core answers slot_unavailable with the message), so two concurrent Book requests
// create one meeting (the unique index sched_poll_active_uq is the last guard). Server only.
import "server-only";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { invitees, meetingPollParticipants, meetingPolls, scheduledEvents, users } from "@/db/schema";
import type { QuestionAnswer } from "@/db/types";
import { AppError } from "@/lib/errors";
import { publishEvent } from "@/lib/events";
import { getT } from "@/lib/i18n";
import { now as clockNow } from "@/lib/time/now";
import { recordActivity } from "./activity";
import { POLL_ERRORS } from "./constants";
import { currentBookingIntent } from "./intent";
import { loadOptions, lockPoll, startOf, statusOf } from "./load";
import { cancelPollTimers, enqueueHoldsSync, enqueuePollEmail, scheduleMeetingReminders } from "./schedule";
import { bookable } from "./state";

export async function markPollBooked(
  tx: DbOrTx,
  p: { pollId: string; optionId: string; scheduledEventId: string; inviteeIds: string[]; bookedByUserId: string },
): Promise<void> {
  const at = clockNow();
  const poll = await lockPoll(tx, p.pollId, "update");
  if (poll.deletedAt || poll.status === "canceled") throw new AppError("conflict", POLL_ERRORS.notFound);
  const options = await loadOptions(tx, poll.id);
  const status = statusOf(poll, options, at);
  if (!bookable(status)) {
    throw new AppError("conflict", status === "booked" ? POLL_ERRORS.pollBooked : status === "expired" ? POLL_ERRORS.pollEnded : POLL_ERRORS.notFound);
  }
  const option = options.find((o) => o.id === p.optionId);
  if (!option) throw new AppError("conflict", POLL_ERRORS.optionNotFound);
  const start = startOf(option, poll.timezone);
  if (start <= at.getTime()) throw new AppError("conflict", POLL_ERRORS.optionPast);
  // A reopened poll whose meeting is still active is rebooked in place (moveScheduledEvent), never a second meeting.
  const [other] = await tx
    .select({ id: scheduledEvents.id })
    .from(scheduledEvents)
    .where(and(eq(scheduledEvents.pollId, poll.id), eq(scheduledEvents.status, "active"), ne(scheduledEvents.id, p.scheduledEventId)))
    .limit(1);
  if (other) throw new AppError("conflict", POLL_ERRORS.pollBooked);

  const intent = currentBookingIntent(poll.id);
  const sendMeetingReminders = intent ? intent.sendMeetingReminders : poll.sendMeetingReminders;
  await tx
    .update(meetingPolls)
    .set({
      status: "booked",
      bookedOptionId: option.id,
      bookedScheduledEventId: p.scheduledEventId,
      bookedAt: at,
      bookedByUserId: p.bookedByUserId,
      votingClosedAt: poll.votingClosedAt ?? at,
      sendMeetingReminders,
      updatedAt: at,
    })
    .where(eq(meetingPolls.id, poll.id));

  // The Book dialog's message reaches every invitee in their confirmation (a labelled answer of their booking).
  const message = intent?.message?.trim();
  if (message && p.inviteeIds.length) {
    const [booker] = await tx.select({ name: users.name }).from(users).where(eq(users.id, p.bookedByUserId)).limit(1);
    const label = getT(poll.locale, "poll-emails")("common.messageFrom", { hostName: booker?.name ?? "" });
    const answer: QuestionAnswer = { questionId: null, question: label, type: "text", position: 0, answer: message };
    await tx.update(invitees).set({ questionsAndAnswers: [answer], updatedAt: at }).where(inArray(invitees.id, p.inviteeIds));
  }

  await recordActivity(tx, {
    pollId: poll.id,
    type: "booked",
    actorUserId: p.bookedByUserId,
    data: { optionId: option.id, scheduledEventId: p.scheduledEventId, invitees: p.inviteeIds.length, auto: intent?.auto ?? false },
    at,
  });
  await publishEvent(tx, "poll.booked", { pollId: poll.id, scheduledEventId: p.scheduledEventId }, {
    organizationId: poll.organizationId,
    actor: intent?.auto ? { type: "system" } : { type: "user", userId: p.bookedByUserId },
  });

  await cancelPollTimers(tx, poll.id);
  if (poll.reserveTimes) await enqueueHoldsSync(tx, poll.id, at);
  if (sendMeetingReminders) await scheduleMeetingReminders(tx, poll.id, p.scheduledEventId, new Date(start), at);

  if (intent?.notifyExcluded) {
    const booked = await tx
      .select({ participantId: invitees.pollParticipantId, email: invitees.emailNormalized })
      .from(invitees)
      .where(inArray(invitees.id, p.inviteeIds.length ? p.inviteeIds : ["00000000-0000-0000-0000-000000000000"]));
    const ids = new Set(booked.map((b) => b.participantId).filter(Boolean));
    const emails = new Set(booked.map((b) => b.email));
    const respondents = await tx
      .select({ id: meetingPollParticipants.id, email: meetingPollParticipants.emailNormalized, status: meetingPollParticipants.status, unsubscribedAt: meetingPollParticipants.unsubscribedAt })
      .from(meetingPollParticipants)
      .where(and(eq(meetingPollParticipants.pollId, poll.id), isNull(meetingPollParticipants.deletedAt)));
    for (const r of respondents) {
      if (r.status === "invited" || !r.email || r.unsubscribedAt || ids.has(r.id) || emails.has(r.email)) continue;
      await enqueuePollEmail(tx, { template: "time_chosen", pollId: poll.id, participantId: r.id, data: { optionId: option.id } }, `${poll.id}:time_chosen:${p.scheduledEventId}:${r.id}`, at);
    }
  }
  if (intent?.auto) {
    await enqueuePollEmail(
      tx,
      { template: "auto_booked", pollId: poll.id, userId: poll.ownerUserId, data: { optionId: option.id, scheduledEventId: p.scheduledEventId } },
      `${poll.id}:auto_booked:${p.scheduledEventId}`,
      at,
    );
  }
}
