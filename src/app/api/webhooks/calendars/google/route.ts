// OWNER: calendar-integrations.
//
// POST /api/webhooks/calendars/google: Google Calendar push notifications (ARCHITECTURE 10.3, events.watch channels
// created by src/lib/calendars/watch.ts). Google sends an empty body with X-Goog-Channel-ID, X-Goog-Channel-Token and
// X-Goog-Resource-State headers; the channel token is verified against its stored hash, the calendar's busy cache is
// marked stale and an immediate CAL-14 sync of that calendar runs after the response. Not cookie authenticated (no
// CSRF surface): only a request carrying a live channel's secret token has any effect.
import { handleGooglePush } from "@/lib/calendars/watch";
import { runJobsAfterResponse } from "@/lib/jobs";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const out = await handleGooglePush(request.headers);
    if (out.jobId) runJobsAfterResponse({ ids: [out.jobId], thenAnyDue: false });
    return new Response(null, { status: out.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log.error("calendars.google_push_failed", { error: e });
    // 5xx makes Google retry with backoff.
    return new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
