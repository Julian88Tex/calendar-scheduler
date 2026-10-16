// OWNER: polls-core.
//
// POST /api/polls/{id}/reopen-voting   "Reopen voting" (SPEC MP-22): { deadline?, notify? } (a new deadline is required
// when the old one has passed) -> { ok, pollId }.
import { readJsonBody, route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { reopenVoting } from "@/lib/polls/server";
import { ReopenPollSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const input = await readJsonBody(request, ReopenPollSchema.omit({ pollId: true }));
  await reopenVoting(actor, { ...input, pollId });
  return ok({ pollId });
});
