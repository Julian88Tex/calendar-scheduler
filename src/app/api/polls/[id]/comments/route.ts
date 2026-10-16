// OWNER: polls-core.
//
// POST /api/polls/{id}/comments   a host reply ("Host" badge, SPEC MP-14): { body } -> 201 { ok, commentId }.
import { readJsonBody, route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { addHostComment } from "@/lib/polls/server";
import { CommentSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const input = await readJsonBody(request, CommentSchema.pick({ body: true }));
  return ok(await addHostComment(actor, pollId, input), 201);
});
