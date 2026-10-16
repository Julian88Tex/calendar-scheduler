// OWNER: polls-core.
//
// POST   /api/polls/{id}/options   "Add times" (SPEC MP-27): { options, notifyParticipants? } -> { ok, added, optionIds,
//                                  notified }. An expired poll reopens.
// DELETE /api/polls/{id}/options   remove times: { optionIds, confirm? } -> { ok, removed, votesRemoved }. Times with Yes
//                                  or If need be votes answer 409 with details { requiresConfirm, voters } until confirm.
import { readJsonBody, route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { addOptions, removeOptions } from "@/lib/polls/server";
import { AddOptionsSchema, RemoveOptionsSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const input = await readJsonBody(request, AddOptionsSchema.omit({ pollId: true }));
  return ok(await addOptions(actor, { ...input, pollId }), 201);
});

export const DELETE = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const input = await readJsonBody(request, RemoveOptionsSchema.omit({ pollId: true }));
  return ok(await removeOptions(actor, { ...input, pollId }));
});
