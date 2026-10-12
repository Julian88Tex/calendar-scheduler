// OWNER: conferencing.
//
// GET /events/{scheduledEventId}/join (SPEC VID-11): the stable join link. 302 to the provider join URL when it is
// known; "Your meeting link is being prepared. This page will refresh automatically." while the conference is being
// created (refresh every 5 seconds, up to 2 minutes); "This meeting was canceled." (404) for canceled meetings; the
// location details for other locations; 404 for unknown ids. Old links of rescheduled meetings follow the reschedule
// to the current meeting. Read only and never cached; the decisions live in src/lib/conferencing/join.ts.
import { appName } from "@/lib/brand";
import { decideJoin, loadJoinMeeting, renderJoinPage } from "@/lib/conferencing/join";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
};

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

function html(page: { status: number; html: string }): Response {
  return new Response(page.html, {
    status: page.status,
    headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": PAGE_CSP },
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const path = `/events/${encodeURIComponent(id)}/join`;
  const attempt = Number.parseInt(url.searchParams.get("attempt") ?? "0", 10);
  let outcome;
  try {
    outcome = decideJoin(await loadJoinMeeting(id), Number.isFinite(attempt) ? attempt : 0);
  } catch (e) {
    log.error("conferencing.join_failed", { scheduledEventId: id, error: e });
    return new Response("Something went wrong. Please try again in a moment.", {
      status: 500,
      headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "5" },
    });
  }
  if (outcome.type === "redirect") {
    return new Response(null, { status: 302, headers: { ...BASE_HEADERS, Location: outcome.url } });
  }
  return html(renderJoinPage(outcome, { appName: appName(), path }));
}
