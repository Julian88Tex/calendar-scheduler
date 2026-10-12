// Domain event subscribers of the workflow engine (ARCHITECTURE sections 12.1 and 14), re-exported by the contract
// file subscribers.ts. Each runs as its own job (`event:{type}:workflows`) right after the change (after() in the
// request that published it, else cron or the poller) and writes in one transaction, so a retry is safe.
import "server-only";
import type { SubscriberMap } from "@/lib/events/types";
import { handleCancellation, handleNoShow, handleReschedule, scheduleForBooking } from "./schedule";

export const workflowSubscribers: SubscriberMap = {
  "booking.created": async (event, ctx) => {
    const { scheduledEventId, inviteeId } = event.payload;
    await ctx.db.transaction((tx) => scheduleForBooking(tx, { scheduledEventId, inviteeId }));
  },
  "booking.canceled": async (event, ctx) => {
    const { scheduledEventId, inviteeId, meetingCanceled } = event.payload;
    await ctx.db.transaction((tx) => handleCancellation(tx, { scheduledEventId, inviteeId, meetingCanceled: meetingCanceled === true }));
  },
  "booking.rescheduled": async (event, ctx) => {
    const { oldInviteeId, newInviteeId, oldScheduledEventId, newScheduledEventId } = event.payload;
    await ctx.db.transaction((tx) => handleReschedule(tx, { oldInviteeId, newInviteeId, oldScheduledEventId, newScheduledEventId }));
  },
  "booking.no_show_created": async (event, ctx) => {
    const { inviteeId, noShowId } = event.payload;
    await ctx.db.transaction((tx) => handleNoShow(tx, { inviteeId, noShowId }));
  },
};
