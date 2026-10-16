// OWNER: polls-core.
//
// POST /api/polls/{id}/invites   "Invite people" (SPEC MP-06): { recipients: [{ email, name?, required? }], subject?,
// message? } -> { ok, invited, resent, skipped }. People who already responded are skipped; 200 emails per user per day.
import { readJsonBody, route } from "@/lib/http";
import { hostActor, ok, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { invitePeople } from "@/lib/polls/server";
import { InviteSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const POST = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const input = await readJsonBody(request, InviteSchema.omit({ pollId: true }));
  return ok(await invitePeople(actor, { ...input, pollId }));
});
