// OWNER: polls-core.
//
// POST /api/polls/{id}/remind   "Send reminder" (SPEC MP-24): { participantIds? } (omitted: every invited person who
// has not responded) -> { ok, sent, throttled }. One manual reminder per person per 12 hours (429 when all throttled).
import { readJsonBody, route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { sendReminders } from "@/lib/polls/server";
import { RemindSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const input = await readJsonBody(request, RemindSchema.omit({ pollId: true }));
  return ok(await sendReminders(actor, { ...input, pollId }));
});
