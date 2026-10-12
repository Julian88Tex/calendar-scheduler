// OWNER: calendar-integrations.
//
// connect_calendar OAuth intent (ARCHITECTURE section 10.4, SPEC CAL-02, CAL-06, CAL-15): the shared Google callback
// (foundation-auth) dispatches here after the code exchange, for a signed-in user. The grant must include the calendar
// scopes (Google's consent screen lets users uncheck them); the account is then connected (or reconnected, keeping its
// settings) and the user returns to the Calendar settings page (or the same-site returnTo) with:
//   ?connected=google                      success (a second Google account adds a second connection)
//   ?connected=google&reconnect_mismatch=1 "Reconnect" was used but another Google account was chosen
//   ?calendar_error=permissions|limit|unsupported|failed
// docs/SCOPE.md: Google only; Microsoft answers "unsupported".
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarConnections } from "@/db/schema";
import { appendQuery, redirectResponse } from "@/lib/auth/oauth/redirects";
import type { OAuthCallbackContext } from "@/lib/auth/oauth/types";
import { isAppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { runJobsAfterResponse } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { safeNextPath } from "@/lib/url";
import { CALENDAR_LIST_JOB, connectGoogleAccount, hasGoogleCalendarScopes, WATCH_JOB } from "./connections";

export const CALENDAR_SETTINGS_PATH = "/app/availability/calendar-settings";

export async function handleConnectCallback(ctx: OAuthCallbackContext): Promise<Response> {
  const base = safeNextPath(ctx.returnTo, CALENDAR_SETTINGS_PATH);
  if (!ctx.userId) return redirectResponse(appendQuery("/login", { next: base }));
  if (ctx.provider !== "google") return redirectResponse(appendQuery(base, { calendar_error: "unsupported", provider: ctx.provider }));
  if (!hasGoogleCalendarScopes(ctx.tokens.scopes)) return redirectResponse(appendQuery(base, { calendar_error: "permissions", provider: "google" }));
  try {
    await connectGoogleAccount({
      userId: ctx.userId,
      providerAccountId: ctx.profile.providerAccountId,
      accountEmail: ctx.profile.email,
      displayName: ctx.profile.name,
      tokens: {
        accessToken: ctx.tokens.accessToken,
        refreshToken: ctx.tokens.refreshToken,
        expiresAt: ctx.tokens.expiresAt,
        scopes: ctx.tokens.scopes,
      },
      via: "connect",
      actor: { type: "user", userId: ctx.userId },
    });
    runJobsAfterResponse({ types: [WATCH_JOB, CALENDAR_LIST_JOB] });
    let mismatch = false;
    const reconnect = ctx.state.data?.reconnect;
    if (reconnect && isUuid(reconnect)) {
      const db = await getDb();
      const [target] = await db
        .select({ accountId: calendarConnections.providerAccountId })
        .from(calendarConnections)
        .where(and(eq(calendarConnections.id, reconnect), eq(calendarConnections.userId, ctx.userId)))
        .limit(1);
      mismatch = Boolean(target && target.accountId !== ctx.profile.providerAccountId);
    }
    return redirectResponse(appendQuery(base, { connected: "google", ...(mismatch ? { reconnect_mismatch: "1" } : {}) }));
  } catch (e) {
    if (isAppError(e) && e.code === "conflict") return redirectResponse(appendQuery(base, { calendar_error: "limit", provider: "google" }));
    log.error("calendars.connect_failed", { userId: ctx.userId, error: e });
    return redirectResponse(appendQuery(base, { calendar_error: "failed", provider: "google" }));
  }
}
