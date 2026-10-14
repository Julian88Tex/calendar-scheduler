// OWNER: polls-core.
//
// POST /api/polls/{id}/duplicate   "Duplicate" (SPEC MP-32): a new open poll with the same settings and the future
// times, no participants -> 201 { ok, pollId, slug, link, eventTypeId }.
import { route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { duplicatePoll } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  return ok(await duplicatePoll(actor, pollId), 201);
});
