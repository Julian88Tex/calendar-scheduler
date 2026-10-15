// OWNER: polls-core.
//
// poll_freebusy OAuth intent (SPEC MP-13, P3; ARCHITECTURE section 10.4): a voter connects Google (calendar.freebusy
// scope, no offline access) or Microsoft once to check their availability against the poll's options. The access
// token is used in memory for the FreeBusy / calendarView calls of this request and then revoked (Google) and
// discarded: no token, account or calendar data is ever written to the database. The busy, free or unknown result per
// option goes back to the voter's browser in a short-lived signed cookie and the voter returns to /p/{slug}?calendar=
// checked. Start link: oauthStartPath("google", { intent: "poll_freebusy", next: `/p/${slug}`, data: { poll: slug } }).
import "server-only";
import type { OAuthCallbackContext } from "@/lib/auth/oauth/types";
import { getDb } from "@/db";
import { log } from "@/lib/logger";
import { now as clockNow } from "@/lib/time/now";
import { absoluteUrl } from "@/lib/url";
import { appendCheckCookie, checkRange, googleBusy, microsoftBusy, type Busy } from "./freebusy";
import { loadOptions, loadPollBySlug } from "./load";
import { checkFromBusy } from "./voter-calendar";

function redirect(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: absoluteUrl(path), "Cache-Control": "no-store, max-age=0" } });
}

export async function handleVoterFreeBusyCallback(ctx: OAuthCallbackContext): Promise<Response> {
  const slug = (ctx.state.data?.poll ?? "").trim().toLowerCase();
  const db = await getDb();
  const found = slug ? await loadPollBySlug(db, slug, clockNow()) : null;
  if (!found || found.poll.deletedAt || found.poll.status === "canceled") {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const poll = found.poll;
  const back = `/p/${encodeURIComponent(poll.slug)}`;
  // The voter's access token is not revoked: Google revokes the whole grant of this app for that Google account, which
  // would also cut the owner's stored calendar and Gmail access if the owner checked their own calendar. The token is
  // never stored, is free/busy only and expires within the hour.
  const token = ctx.tokens.accessToken;
  try {
    const options = await loadOptions(db, poll.id);
    const range = checkRange(poll, options, clockNow());
    let busy: Busy[] = [];
    if (range) busy = ctx.provider === "google" ? await googleBusy(token, range) : await microsoftBusy(token, range);
    const { cookie } = await checkFromBusy(poll, options, busy, ctx.provider);
    return appendCheckCookie(redirect(`${back}?calendar=checked`), poll.slug, cookie);
  } catch (e) {
    log.warn("polls.voter_freebusy_failed", { provider: ctx.provider, error: e });
    return redirect(`${back}?oauth_error=failed&provider=${ctx.provider}`);
  }
}
