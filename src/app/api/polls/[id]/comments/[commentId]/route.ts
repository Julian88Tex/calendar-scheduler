// OWNER: polls-core.
//
// DELETE /api/polls/{id}/comments/{commentId}   hosts delete any comment (SPEC MP-14) -> { ok, commentId }.
import { route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollChildRouteCtx } from "@/lib/polls/route-helpers";
import { deleteHostComment } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const DELETE = route<PollChildRouteCtx<"commentId">>(async (request, ctx) => {
  const actor = await hostActor(request);
  const params = await ctx.params;
  const pollId = uuidParam(params.id);
  const commentId = uuidParam(params.commentId, "This comment no longer exists.");
  await deleteHostComment(actor, pollId, commentId);
  return ok({ commentId });
});
