// OWNER: golden-path-qa (added for the voter page's HTTP 410; polls-core owns the rest of /api/public/polls).
//
// GET /api/public/polls/{slug}/state   whether a poll link is still live, for src/proxy.ts: 410 { state: "gone" } for a
// deleted or canceled poll (an old link ending of one included), 200 { state: "live" } otherwise, 404 for an unknown
// slug. One indexed lookup and no details, so the proxy can ask it before every voter page view and answer the page
// of a gone poll with a real 410 (SPEC MP-22 "a deleted poll returns 410").
//
// These three answers are cacheable at the CDN for a short time (POLL_STATE_CACHE_CONTROL), so most voter page views
// cost neither a function call nor a database query. A deletion or cancellation therefore shows in the voter page's
// HTTP status within at most 30 seconds (20 fresh plus 10 stale while revalidating); the page itself always renders the
// current state ("This poll is no longer available."), only its status can lag. A gone poll never becomes live again
// (canceled and deleted are final). Errors (malformed slug, database down) stay no-store.
import { getDb } from "@/db";
import { json, route } from "@/lib/http";
import { loadPollBySlug } from "@/lib/polls/load";
import { slugParam, type PublicPollRouteCtx } from "@/lib/polls/route-helpers";
import { now } from "@/lib/time/now";

export const dynamic = "force-dynamic";

/** CDN caching of the state answers (browsers revalidate every time; Vercel strips s-maxage and stale-while-revalidate). */
const POLL_STATE_CACHE_CONTROL = "public, max-age=0, s-maxage=20, stale-while-revalidate=10";

const cacheable = (status: number, body: unknown) => json(body, { status, headers: { "Cache-Control": POLL_STATE_CACHE_CONTROL } });

export const GET = route<PublicPollRouteCtx>(async (_request, ctx) => {
  const slug = slugParam((await ctx.params).slug);
  const found = await loadPollBySlug(await getDb(), slug, now());
  if (!found) return cacheable(404, { error: "not_found", message: "This poll could not be found." });
  const gone = Boolean(found.poll.deletedAt) || found.poll.status === "canceled";
  return gone ? cacheable(410, { state: "gone" }) : cacheable(200, { state: "live" });
});
