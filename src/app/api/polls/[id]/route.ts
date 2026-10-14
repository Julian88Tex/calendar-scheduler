// OWNER: polls-core.
//
// GET    /api/polls/{id}   the results page data (SPEC MP-16, MP-17) -> HostPollView; ?markViewed=1 clears the "New"
//                          dot (MP-26).
// PATCH  /api/polls/{id}   edit after publish (MP-27): UpdatePollInput without pollId -> { ok, pollId, slug, fields }.
//                          A more public results visibility with respondents answers 400 with details.requiresConfirm
//                          until confirmPublic is true.
// DELETE /api/polls/{id}   "Delete poll" (owner or org admin): { notify?, cancelMeeting?, reason? } -> { ok }.
import { json, readJsonBody, route } from "@/lib/http";
import { boolParam, hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { deletePoll, getHostPoll, updatePoll } from "@/lib/polls/server";
import { DeletePollSchema, UpdatePollSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const GET = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const markViewed = boolParam(new URL(request.url).searchParams.get("markViewed"), false);
  return json(await getHostPoll(actor, pollId, { markViewed }));
});

export const PATCH = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const input = await readJsonBody(request, UpdatePollSchema.omit({ pollId: true }));
  return ok(await updatePoll(actor, { ...input, pollId }));
});

export const DELETE = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const input = await readJsonBody(request, DeletePollSchema.omit({ pollId: true }));
  await deletePoll(actor, { ...input, pollId });
  return ok({ pollId });
});
