// OWNER: foundation-auth.
//
// GET /api/auth/jsuite?token=...&next=... : the JSuite hand-off. Verifies the token, resolves the account as a Google
// login (find by Google subject, link by verified email, or create under the signup policy), then starts a session the
// same way the OAuth callback does (two factor still applies).
import { auditAuth } from "@/lib/auth/flows/audit";
import { sendWelcomeEmail } from "@/lib/auth/flows/auth-emails";
import { OAuthFlowError, resolveOAuthLogin } from "@/lib/auth/flows/oauth-accounts";
import { requestMetaFrom } from "@/lib/auth/flows/request-context";
import { POST_SIGNUP_PATH } from "@/lib/auth/flows/signup-flow";
import { verifyJsuiteToken } from "@/lib/auth/jsuite";
import { appendQuery, redirectResponse } from "@/lib/auth/oauth/redirects";
import { createSession, getSession, revokeSession } from "@/lib/auth/session";
import { log } from "@/lib/logger";
import { safeNextPath } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let profile;
  try {
    profile = await verifyJsuiteToken(url.searchParams.get("token") ?? "");
  } catch (e) {
    log.warn("jsuite.token_rejected", { error: e });
    return redirectResponse("/login?error=failed&provider=google");
  }

  try {
    const meta = requestMetaFrom(request);
    const res = await resolveOAuthLogin({ provider: "google", profile });
    if (res.created) {
      await auditAuth("user.signup", { user: res.user, details: { method: "google", via: "jsuite" }, meta });
      await sendWelcomeEmail(res.user);
    }
    const destination = res.created ? POST_SIGNUP_PATH : safeNextPath(url.searchParams.get("next"));
    const current = await getSession().catch(() => null);
    if (current) await revokeSession(current.session.id);
    if (res.user.twoFactorEnabled) {
      await createSession(res.user.id, { twoFactorPending: true });
      return redirectResponse(appendQuery("/login/two-factor", { next: destination, method: "google" }));
    }
    await createSession(res.user.id, { twoFactorPending: false });
    await auditAuth("user.login", { user: res.user, details: { method: "google", via: "jsuite" }, meta });
    return redirectResponse(destination);
  } catch (e) {
    if (e instanceof OAuthFlowError) return redirectResponse(`/login?error=${e.code}&provider=google`);
    log.error("jsuite.sign_in_failed", { error: e });
    return redirectResponse("/login?error=failed&provider=google");
  }
}
