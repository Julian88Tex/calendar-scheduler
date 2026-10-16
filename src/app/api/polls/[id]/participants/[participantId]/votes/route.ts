// OWNER: polls-core.
//
// PUT /api/polls/{id}/participants/{participantId}/votes   "Edit votes" on behalf (SPEC MP-17): { votes: [{ optionId,
// choice }], notify? } -> { ok, participantId }. Past options stay frozen; the participant is emailed when notify.
import { readJsonBody, route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollChildRouteCtx } from "@/lib/polls/route-helpers";
import { setParticipantVotes } from "@/lib/polls/server";
import { SetVotesSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const PUT = route<PollChildRouteCtx<"participantId">>(async (request, ctx) => {
  const actor = await hostActor(request);
  const params = await ctx.params;
  const pollId = uuidParam(params.id);
  const participantId = uuidParam(params.participantId, "This participant is no longer part of the poll.");
  const input = await readJsonBody(request, SetVotesSchema.omit({ pollId: true, participantId: true }));
  return ok(await setParticipantVotes(actor, { ...input, pollId, participantId }));
});
