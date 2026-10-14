// OWNER: polls-core.
//
// GET /api/public/polls/{slug}/event.ics   "Add to calendar" for a booked poll (SPEC MP-15 Booked state): the meeting
// as an iCalendar download (METHOD PUBLISH, the meeting's UID so it merges with the invitation). 404 unless the poll is
// booked, its meeting is active and the caller (edit cookie, ?i={invite token} or signed-in user) is an invitee of it or
// a host: the file carries the join link.
import { getCurrentUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { slugParam, type PublicPollRouteCtx } from "@/lib/polls/route-helpers";
import { getBookedMeetingIcs, readEditToken } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const GET = route<PublicPollRouteCtx>(async (request, ctx) => {
  const slug = slugParam((await ctx.params).slug);
  const user = await getCurrentUser();
  const file = await getBookedMeetingIcs(slug, {
    editToken: readEditToken(request),
    inviteToken: new URL(request.url).searchParams.get("i"),
    userId: user?.id ?? null,
    viewer: user ? { userId: user.id, email: user.email } : null,
  });
  if (!file) throw new AppError("not_found", "This meeting is not scheduled.");
  return new Response(file.ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8; method=PUBLISH",
      "Content-Disposition": `attachment; filename="${file.filename.replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
});
