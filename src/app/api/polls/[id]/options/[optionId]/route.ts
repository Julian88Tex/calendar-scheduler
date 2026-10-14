// OWNER: polls-core.
//
// DELETE /api/polls/{id}/options/{optionId}?confirm=1   removes one time (SPEC MP-27) -> { ok, removed, votesRemoved };
// 409 with details { requiresConfirm, voters } when it has Yes or If need be votes and confirm is not set.
import { route } from "@/lib/http";
import { boolParam, hostActor, ok, uuidParam, type PollChildRouteCtx } from "@/lib/polls/route-helpers";
import { removeOptions } from "@/lib/polls/server";
import { POLL_ERRORS } from "@/lib/polls/constants";

export const dynamic = "force-dynamic";

export const DELETE = route<PollChildRouteCtx<"optionId">>(async (request, ctx) => {
  const actor = await hostActor(request);
  const params = await ctx.params;
  const pollId = uuidParam(params.id);
  const optionId = uuidParam(params.optionId, POLL_ERRORS.optionNotFound);
  const confirm = boolParam(new URL(request.url).searchParams.get("confirm"), false);
  return ok(await removeOptions(actor, { pollId, optionIds: [optionId], confirm }));
});
