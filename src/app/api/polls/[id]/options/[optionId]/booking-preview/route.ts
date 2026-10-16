// OWNER: polls-core.
//
// GET /api/polls/{id}/options/{optionId}/booking-preview   the Book dialog data (SPEC MP-18): the time in the host's
// zone, proposed invitees (respondents who said Yes or If need be, plus invited people), host conflicts and the
// default message -> BookingPreview.
import { json, route } from "@/lib/http";
import { POLL_ERRORS } from "@/lib/polls/constants";
import { hostActor, uuidParam, type PollChildRouteCtx } from "@/lib/polls/route-helpers";
import { bookingPreview } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const GET = route<PollChildRouteCtx<"optionId">>(async (request, ctx) => {
  const actor = await hostActor(request);
  const params = await ctx.params;
  return json(await bookingPreview(actor, uuidParam(params.id), uuidParam(params.optionId, POLL_ERRORS.optionNotFound)));
});
