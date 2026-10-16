// Domain event subscribers of meeting polls (ARCHITECTURE 12.1; key "polls"): booking.canceled on a poll meeting. The
// poll stays booked when its meeting is canceled from Meetings (the results page shows "Meeting canceled" with
// "Reopen poll", MP-21); the activity feed records it and pending meeting reminders are canceled. An invitee who
// canceled their own attendance ("Can't make it?") is recorded too (lifecycle-core emails the host). Server only.
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { invitees, meetingPollActivity, meetingPolls, scheduledEvents } from "@/db/schema";
import type { DomainEvent, SubscriberMap } from "@/lib/events";
import type { JobContext } from "@/lib/jobs";
import { recordActivity } from "./activity";
import { cancelMeetingReminders } from "./schedule";

export async function onPollMeetingCanceled(event: DomainEvent<"booking.canceled">, ctx: JobContext): Promise<void> {
  const { scheduledEventId, inviteeId, meetingCanceled } = event.payload;
  const [m] = await ctx.db.select({ pollId: scheduledEvents.pollId, status: scheduledEvents.status }).from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).limit(1);
  if (!m?.pollId) return;
  const [poll] = await ctx.db.select({ id: meetingPolls.id, bookedScheduledEventId: meetingPolls.bookedScheduledEventId }).from(meetingPolls).where(eq(meetingPolls.id, m.pollId)).limit(1);
  if (!poll) return;
  // A retried job records the event once.
  const [seen] = await ctx.db
    .select({ id: meetingPollActivity.id })
    .from(meetingPollActivity)
    .where(and(eq(meetingPollActivity.pollId, poll.id), sql`${meetingPollActivity.data}->>'eventId' = ${event.id}`))
    .limit(1);
  if (seen) return;
  const whole = meetingCanceled || m.status === "canceled";
  const [inv] = whole ? [] : await ctx.db.select({ name: invitees.name }).from(invitees).where(eq(invitees.id, inviteeId)).limit(1);
  await ctx.db.transaction(async (tx) => {
    await recordActivity(tx, {
      pollId: poll.id,
      type: "edited",
      data: whole ? { kind: "meeting_canceled", scheduledEventId, eventId: event.id } : { kind: "invitee_canceled", scheduledEventId, inviteeId, name: inv?.name ?? null, eventId: event.id },
      at: ctx.now,
    });
    if (whole && poll.bookedScheduledEventId === scheduledEventId) await cancelMeetingReminders(tx, poll.id);
  });
}

export const pollSubscribers: SubscriberMap = {
  "booking.canceled": (event, ctx) => onPollMeetingCanceled(event, ctx),
};
