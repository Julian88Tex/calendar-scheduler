// OWNER: polls-core.
//
// DELETE /api/public/polls/{slug}/comments/{commentId}   a voter deletes their own comment (SPEC MP-14; identified by
// the edit cookie) -> { ok, commentId }; 403 for someone else's comment.
import { getCurrentUser } from "@/lib/auth/session";
import { assertSameOrigin, route } from "@/lib/http";
import { ok, slugParam, uuidParam, type PublicPollChildRouteCtx } from "@/lib/polls/route-helpers";
import { deletePublicComment, readEditToken } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const DELETE = route<PublicPollChildRouteCtx<"commentId">>(async (request, ctx) => {
  assertSameOrigin(request);
  const params = await ctx.params;
  const slug = slugParam(params.slug);
  const commentId = uuidParam(params.commentId, "This comment no longer exists.");
  const user = await getCurrentUser();
  await deletePublicComment(slug, commentId, { editToken: readEditToken(request), userId: user?.id ?? null });
  return ok({ commentId });
});
