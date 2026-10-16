// OWNER: polls-core.
//
// POST /api/polls/{id}/participants   "Add participant" with votes on their behalf (SPEC MP-17; source host_added):
// { name, email?, votes, isRequired?, notify? } -> 201 { ok, participantId }.
import { readJsonBody, route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { addParticipant } from "@/lib/polls/server";
import { AddParticipantSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const input = await readJsonBody(request, AddParticipantSchema.omit({ pollId: true }));
  return ok(await addParticipant(actor, { ...input, pollId }), 201);
});
