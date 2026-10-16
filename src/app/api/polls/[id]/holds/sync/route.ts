// OWNER: polls-core.
//
// POST /api/polls/{id}/holds/sync   "Try again" for holds that failed to reach a calendar (SPEC MP-25) -> { ok, pollId }.
import { route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { retryHolds } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  await retryHolds(actor, pollId);
  return ok({ pollId });
});
