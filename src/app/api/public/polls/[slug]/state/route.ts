// OWNER: golden-path-qa (added for the voter page's HTTP 410; polls-core owns the rest of /api/public/polls).
//
// GET /api/public/polls/{slug}/state   whether a poll link is still live, for src/proxy.ts: 410 { state: "gone" } for a
// deleted or canceled poll (an old link ending of one included), 200 { state: "live" } otherwise, 404 for an unknown
// slug. One indexed lookup and no details, so the proxy can ask it before every voter page view and answer the page
// of a gone poll with a real 410 (SPEC MP-22 "a deleted poll returns 410").
import { getDb } from "@/db";
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { loadPollBySlug } from "@/lib/polls/load";
import { slugParam, type PublicPollRouteCtx } from "@/lib/polls/route-helpers";
import { now } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export const GET = route<PublicPollRouteCtx>(async (_request, ctx) => {
  const slug = slugParam((await ctx.params).slug);
  const found = await loadPollBySlug(await getDb(), slug, now());
  if (!found) throw new AppError("not_found", "This poll could not be found.");
  const gone = Boolean(found.poll.deletedAt) || found.poll.status === "canceled";
  return gone ? json({ state: "gone" }, { status: 410 }) : json({ state: "live" });
});
