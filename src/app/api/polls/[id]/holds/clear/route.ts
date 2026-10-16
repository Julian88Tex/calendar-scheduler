// OWNER: polls-core.
//
// POST /api/polls/{id}/holds/clear   "Release held times" (SPEC MP-25): turns Reserve times off and removes the holds
// from the hosts' calendars -> { ok, pollId }.
import { route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { clearHolds } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  await clearHolds(actor, pollId);
  return ok({ pollId });
});
