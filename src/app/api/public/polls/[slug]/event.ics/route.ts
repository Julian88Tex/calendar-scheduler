// OWNER: polls-core.
//
// GET /api/public/polls/{slug}/event.ics   "Add to calendar" for a booked poll (SPEC MP-15 Booked state): the meeting
// as an iCalendar download (METHOD PUBLISH, the meeting's UID so it merges with the invitation). 404 unless the poll is
// booked and its meeting is active.
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { slugParam, type PublicPollRouteCtx } from "@/lib/polls/route-helpers";
import { getBookedMeetingIcs } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const GET = route<PublicPollRouteCtx>(async (_request, ctx) => {
  const slug = slugParam((await ctx.params).slug);
  const file = await getBookedMeetingIcs(slug);
  if (!file) throw new AppError("not_found", "This meeting is not scheduled.");
  return new Response(file.ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8; method=PUBLISH",
      "Content-Disposition": `attachment; filename="${file.filename.replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
});
