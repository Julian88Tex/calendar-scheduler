// OWNER: polls-core.
//
// POST /api/polls/{id}/book   "Book meeting" (SPEC MP-18, MP-19, MP-21): { optionId, invitees: [{ participantId?, name?,
// email }], message?, sendMeetingReminders?, notifyExcluded? } -> { ok, ...BookPollResult }. 409 slot_unavailable when
// a host already has a meeting at that time; a second click returns the same meeting.
import { readJsonBody, route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { bookPoll } from "@/lib/polls/server";
import { BookPollSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const input = await readJsonBody(request, BookPollSchema.omit({ pollId: true }));
  return ok(await bookPoll(actor, { ...input, pollId }));
});
