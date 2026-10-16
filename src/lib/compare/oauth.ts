// compare_calendar OAuth intent (booking page "Compare with my calendar"): Google only, scopes calendar.freebusy and
// calendar.calendarlist.readonly, no offline access (src/lib/auth/oauth/google.ts). The callback seals the visitor's
// access token into their browser (session.ts) and returns to the booking page with ?compare=1, which reopens the
// compare panel. Nothing is written to the database. Start link:
//   oauthStartPath("google", { intent: "compare_calendar", next: "/{handle}/{event}?compare=1" })
import "server-only";
import { appendQuery, oauthErrorRedirect, redirectResponse } from "@/lib/auth/oauth/redirects";
import type { OAuthCallbackContext } from "@/lib/auth/oauth/types";
import { safeNextPath } from "@/lib/url";
import { COMPARE_PARAM } from "./constants";
import { appendCompareCookie, newCompareSession } from "./session";

export async function handleCompareCallback(ctx: OAuthCallbackContext): Promise<Response> {
  if (ctx.provider !== "google") return redirectResponse(oauthErrorRedirect("compare_calendar", ctx.state, ctx.provider, "not_configured"));
  const session = newCompareSession({ accessToken: ctx.tokens.accessToken, email: ctx.profile.email, expiresAt: ctx.tokens.expiresAt });
  const back = appendQuery(safeNextPath(ctx.returnTo, "/"), { [COMPARE_PARAM]: "1" });
  return appendCompareCookie(redirectResponse(back), session);
}
