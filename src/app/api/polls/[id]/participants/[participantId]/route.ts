// OWNER: polls-core.
//
// PATCH  /api/polls/{id}/participants/{participantId}   { name?, isRequired? } -> { ok, participantId } (SPEC MP-17).
// DELETE /api/polls/{id}/participants/{participantId}   "Remove from poll" -> { ok, participantId }; ?notify=0 skips
//                                                      the email to the participant.
import { readJsonBody, route } from "@/lib/http";
import { boolParam, hostActor, ok, uuidParam, type PollChildRouteCtx } from "@/lib/polls/route-helpers";
import { removeParticipant, updateParticipant } from "@/lib/polls/server";
import { UpdateParticipantSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

const NOT_FOUND = "This participant is no longer part of the poll.";

export const PATCH = route<PollChildRouteCtx<"participantId">>(async (request, ctx) => {
  const actor = await hostActor(request);
  const params = await ctx.params;
  const pollId = uuidParam(params.id);
  const participantId = uuidParam(params.participantId, NOT_FOUND);
  const input = await readJsonBody(request, UpdateParticipantSchema.omit({ pollId: true, participantId: true }));
  await updateParticipant(actor, { ...input, pollId, participantId });
  return ok({ participantId });
});

export const DELETE = route<PollChildRouteCtx<"participantId">>(async (request, ctx) => {
  const actor = await hostActor(request);
  const params = await ctx.params;
  const pollId = uuidParam(params.id);
  const participantId = uuidParam(params.participantId, NOT_FOUND);
  const notify = boolParam(new URL(request.url).searchParams.get("notify"), true);
  await removeParticipant(actor, { pollId, participantId, notify });
  return ok({ participantId });
});
