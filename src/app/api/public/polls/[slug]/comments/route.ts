// OWNER: polls-core.
//
// POST /api/public/polls/{slug}/comments   a voter's comment (SPEC MP-14): { body, name?, inviteToken? } (name required
// unless the caller already voted; inviteToken is the page's ?i= when the voter came through their invite link) -> 201 { ok, commentId }. In host_only polls the comment is visible to hosts and its author
// only. Same origin only; 20 comments per IP per hour; 200 per poll.
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { assertSameOrigin, getClientIp, readJsonBody, route } from "@/lib/http";
import { ok, slugParam, type PublicPollRouteCtx } from "@/lib/polls/route-helpers";
import { addPublicComment, readEditToken } from "@/lib/polls/server";
import { CommentSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const POST = route<PublicPollRouteCtx>(async (request, ctx) => {
  assertSameOrigin(request);
  const slug = slugParam((await ctx.params).slug);
  const { inviteToken, ...input } = await readJsonBody(request, CommentSchema.extend({ inviteToken: z.string().trim().max(200).nullish() }));
  const user = await getCurrentUser();
  return ok(await addPublicComment(slug, input, { editToken: readEditToken(request), inviteToken: inviteToken ?? null, userId: user?.id ?? null, ip: getClientIp(request) }), 201);
});
