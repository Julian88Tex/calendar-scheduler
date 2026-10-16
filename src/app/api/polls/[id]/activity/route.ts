// OWNER: polls-core.
//
// GET /api/polls/{id}/activity?since={ISO instant}   the activity feed (SPEC MP-16 "Activity"), newest first; with
// since, only newer rows (live updates on the results page) -> { activity: PollActivityView[] }.
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { hostActor, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { getPollActivity } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const GET = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const raw = new URL(request.url).searchParams.get("since");
  const since = raw ? new Date(raw) : null;
  if (since && Number.isNaN(since.getTime())) throw new AppError("validation", "since must be an ISO date and time.");
  return json({ activity: await getPollActivity(actor, pollId, since) });
});
