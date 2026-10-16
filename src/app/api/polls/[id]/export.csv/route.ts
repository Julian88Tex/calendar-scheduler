// OWNER: polls-core.
//
// GET /api/polls/{id}/export.csv?timezone={IANA}   "Export CSV" (SPEC MP-32): one row per participant, one column per
// time (Yes, If need be, No or blank), times in the given zone (default the host's profile zone). Cells starting with
// = + - @ are prefixed with an apostrophe (formula injection).
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { hostActor, uuidParam, type PollRouteCtx } from "@/lib/polls/route-helpers";
import { exportPollCsv } from "@/lib/polls/server";
import { isValidTimeZone } from "@/lib/time/zones";

export const dynamic = "force-dynamic";

export const GET = route<PollRouteCtx>(async (request, ctx) => {
  const actor = await hostActor(request);
  const pollId = uuidParam((await ctx.params).id);
  const timezone = new URL(request.url).searchParams.get("timezone") ?? undefined;
  if (timezone && !isValidTimeZone(timezone)) throw new AppError("validation", "Choose a valid time zone.");
  const { filename, csv } = await exportPollCsv(actor, pollId, timezone);
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
});
