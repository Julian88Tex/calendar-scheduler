// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// OAuth intent dispatch (ARCHITECTURE section 10.4), after the callback validated the state and exchanged the code:
// - login, signup: resolveOAuthLogin (find, link by verified email, or create under the signup policy), then
//   calendars.linkCalendarFromOAuth (CAL-17), a session (two_factor_pending when 2FA is on, AU-09), audit entries and
//   a redirect to the same-site returnTo or /app/scheduling (new accounts: POST_SIGNUP_PATH).
// - link_login_method: connects the provider to the signed-in user who started the flow, then
//   linkCalendarFromOAuth, then back to returnTo (default Settings > Login) with ?connected={provider}.
// - accept_invitation: teams.getPendingInvitation, the email match rule ("Use {invited email} to accept this
//   invitation."), account creation inside the inviting organization without the signup policy, then
//   teams.acceptInvitationInTx, linkCalendarFromOAuth and a session.
// - connect_calendar: calendars.handleConnectCallback (signed-in users only).
// - poll_freebusy: polls.handleVoterFreeBusyCallback (tokens are never persisted).
// Failures redirect with an error code (src/lib/auth/oauth/errors.ts), never with free text.
import "server-only";
import { linkCalendarFromOAuth } from "@/lib/calendars";
import { handleConnectCallback } from "@/lib/calendars/oauth-connect";
import { log } from "@/lib/logger";
import { handleVoterFreeBusyCallback } from "@/lib/polls/voter-oauth";
import { safeNextPath } from "@/lib/url";
import { auditAuth } from "../flows/audit";
import { sendWelcomeEmail } from "../flows/auth-emails";
import {
  OAuthFlowError,
  acceptInvitationWithOAuth,
  assertSameUser,
  linkOAuthLoginMethod,
  resolveOAuthLogin,
  type OAuthResolution,
} from "../flows/oauth-accounts";
import { requestMetaFrom } from "../flows/request-context";
import { POST_SIGNUP_PATH } from "../flows/signup-flow";
import { createSession, getSession, revokeSession } from "../session";
import { appendQuery, oauthErrorRedirect, redirectResponse } from "./redirects";
import type { OAuthCallbackContext, OAuthIntent } from "./types";

export { OAUTH_INTENTS, type OAuthIntent } from "./types";

export function isOAuthIntent(value: unknown): value is OAuthIntent {
  return (
    value === "login" ||
    value === "signup" ||
    value === "connect_calendar" ||
    value === "poll_freebusy" ||
    value === "link_login_method" ||
    value === "accept_invitation"
  );
}

/** CAL-17: every sign-in creates or refreshes the calendar connection; a failure never blocks the sign-in. */
async function linkCalendar(ctx: OAuthCallbackContext, res: OAuthResolution): Promise<void> {
  try {
    await linkCalendarFromOAuth({
      userId: res.user.id,
      provider: ctx.provider,
      providerAccountId: ctx.profile.providerAccountId,
      accountEmail: ctx.profile.email,
      oauthAccountId: res.oauthAccountId,
      tokens: {
        accessToken: ctx.tokens.accessToken,
        refreshToken: ctx.tokens.refreshToken,
        expiresAt: ctx.tokens.expiresAt,
        scopes: ctx.tokens.scopes,
      },
    });
  } catch (e) {
    log.error("oauth.link_calendar_failed", { provider: ctx.provider, userId: res.user.id, error: e });
  }
}

/** Replaces whatever session the browser had (never leaves an orphaned valid session behind). */
async function startSession(userId: string, twoFactorPending: boolean): Promise<void> {
  const current = await getSession().catch(() => null);
  if (current) await revokeSession(current.session.id);
  await createSession(userId, { twoFactorPending });
}

/** Session, audit and redirect after login, signup and invitation acceptance. */
async function finishSignIn(ctx: OAuthCallbackContext, res: OAuthResolution, opts: { via?: "invitation" } = {}): Promise<Response> {
  const meta = requestMetaFrom(ctx.request);
  await linkCalendar(ctx, res);
  if (res.created) {
    await auditAuth("user.signup", { user: res.user, details: { method: ctx.provider, ...(opts.via ? { via: opts.via } : {}) }, meta });
    await sendWelcomeEmail(res.user);
  }
  if (res.linked) {
    await auditAuth("login_method.connected", {
      user: res.user,
      details: {
        provider: ctx.provider,
        email: ctx.profile.email,
        auto: true,
        ...(res.securedUnverifiedAccount ? { securedUnverifiedAccount: true } : {}),
      },
      meta,
    });
  }
  const destination = res.created ? POST_SIGNUP_PATH : safeNextPath(ctx.returnTo);
  if (res.user.twoFactorEnabled) {
    await startSession(res.user.id, true);
    return redirectResponse(appendQuery("/login/two-factor", { next: destination, method: ctx.provider }));
  }
  await startSession(res.user.id, false);
  await auditAuth("user.login", { user: res.user, details: { method: ctx.provider }, meta });
  return redirectResponse(destination);
}

/** Runs the intent of a completed OAuth callback and returns the response (usually a redirect). */
export async function dispatchOAuthIntent(ctx: OAuthCallbackContext): Promise<Response> {
  try {
    switch (ctx.intent) {
      case "connect_calendar": {
        if (!ctx.userId) return redirectResponse(appendQuery("/login", { next: ctx.returnTo ?? "/app/availability/calendar-settings" }));
        return await handleConnectCallback(ctx);
      }
      case "poll_freebusy":
        return await handleVoterFreeBusyCallback(ctx);
      case "link_login_method": {
        const session = await getSession().catch(() => null);
        const userId = assertSameUser(ctx.userId, session && !session.session.twoFactorPending ? session.user.id : null);
        const res = await linkOAuthLoginMethod({ userId, provider: ctx.provider, profile: ctx.profile });
        await linkCalendar(ctx, res);
        if (res.linked) {
          await auditAuth("login_method.connected", {
            user: res.user,
            details: { provider: ctx.provider, email: ctx.profile.email },
            meta: requestMetaFrom(ctx.request),
          });
        }
        return redirectResponse(appendQuery(safeNextPath(ctx.returnTo, "/app/settings/login"), { connected: ctx.provider }));
      }
      case "accept_invitation": {
        const res = await acceptInvitationWithOAuth({
          provider: ctx.provider,
          profile: ctx.profile,
          invitationToken: ctx.state.invitationToken ?? "",
          timezone: ctx.state.data?.tz ?? null,
        });
        return await finishSignIn(ctx, res, { via: "invitation" });
      }
      case "login":
      case "signup":
      default: {
        const res = await resolveOAuthLogin({ provider: ctx.provider, profile: ctx.profile, timezone: ctx.state.data?.tz ?? null });
        return await finishSignIn(ctx, res);
      }
    }
  } catch (e) {
    if (e instanceof OAuthFlowError) {
      // Every refused sign-in is audited (it needed a valid provider code, so this cannot be flooded).
      if (ctx.intent === "login" || ctx.intent === "signup" || ctx.intent === "accept_invitation") {
        await auditAuth("user.login_failed", {
          details: { method: ctx.provider, reason: e.code, email: ctx.profile.email },
          meta: requestMetaFrom(ctx.request),
        }).catch(() => undefined);
      }
      return redirectResponse(oauthErrorRedirect(ctx.intent, ctx.state, ctx.provider, e.code));
    }
    log.error("oauth.intent_failed", { provider: ctx.provider, intent: ctx.intent, error: e });
    return redirectResponse(oauthErrorRedirect(ctx.intent, ctx.state, ctx.provider, "failed"));
  }
}
