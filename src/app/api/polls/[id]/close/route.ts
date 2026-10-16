// OWNER: polls-core.
//
// POST /api/polls/{id}/close   "Close voting" (SPEC MP-22) -> { ok, pollId }. Voters see "Voting for this poll has
// closed." and the host can still book.
import { route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { closeVoting } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  await closeVoting(actor, pollId);
  return ok({ pollId });
});
