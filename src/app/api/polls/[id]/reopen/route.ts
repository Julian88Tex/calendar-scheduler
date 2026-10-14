// OWNER: polls-core.
//
// POST /api/polls/{id}/reopen   "Reopen poll" after booking (SPEC MP-21): { deadline?, notify? } -> { ok, pollId }.
// The booked meeting stays until the host books again (same option: invitees reconciled; another: the meeting moves).
import { readJsonBody, route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { reopenPoll } from "@/lib/polls/server";
import { ReopenPollSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const input = await readJsonBody(request, ReopenPollSchema.omit({ pollId: true }));
  await reopenPoll(actor, { ...input, pollId });
  return ok({ pollId });
});
