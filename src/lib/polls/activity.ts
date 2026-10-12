// Poll activity feed rows (SPEC MP-16 "Activity", MP-23 digests and live updates). Server only.
//
// data shapes by type (read by the results page):
//   created            { options }
//   edited             { fields: string[] }  meeting canceled from Meetings: { kind: "meeting_canceled", scheduledEventId }
//                      invitee left: { kind: "invitee_canceled", inviteeId, name }
//   options_added      { count, optionIds }        options_removed { count, optionIds, votesRemoved }
//   invited            { count, participantIds }   reminder_sent { count, manual }
//   voted / vote_changed / declined { name }       participant_removed { name }
//   commented          { commentId, hostOnly }     comment_deleted { commentId }
//   voting_closed      { reason: "deadline" | "host" }   voting_reopened {}
//   booked             { optionId, scheduledEventId, invitees, auto }   rebooked { optionId, fromOptionId, scheduledEventId }
//   reopened {}  canceled { cancelMeeting }  expired {}
import "server-only";
import type { DbOrTx } from "@/db";
import { meetingPollActivity } from "@/db/schema";
import { now as clockNow } from "@/lib/time/now";

export type PollActivityType = (typeof meetingPollActivity.$inferInsert)["type"];

export async function recordActivity(
  tx: DbOrTx,
  a: { pollId: string; type: PollActivityType; participantId?: string | null; actorUserId?: string | null; data?: Record<string, unknown>; at?: Date },
): Promise<string> {
  const [row] = await tx
    .insert(meetingPollActivity)
    .values({
      pollId: a.pollId,
      type: a.type,
      participantId: a.participantId ?? null,
      actorUserId: a.actorUserId ?? null,
      data: a.data ?? {},
      createdAt: a.at ?? clockNow(),
    })
    .returning({ id: meetingPollActivity.id });
  return row!.id;
}
