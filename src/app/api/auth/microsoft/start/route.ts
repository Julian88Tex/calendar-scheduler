// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// GET /api/auth/microsoft/start?intent=login|signup|connect_calendar|poll_freebusy|link_login_method|accept_invitation&next=...
// (ARCHITECTURE sections 10.4 and 18.4, SPEC AU-03): stores intent, PKCE verifier, state and returnTo in the 10 minute
// sealed state cookie and redirects to Microsoft (src/lib/auth/oauth/flow.ts). Build links with oauthStartPath() from
// src/lib/auth/oauth/links.ts.
import { handleOAuthStart } from "@/lib/auth/oauth/flow";
import { redirectResponse } from "@/lib/auth/oauth/redirects";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleOAuthStart(request, "microsoft");
  } catch (e) {
    log.error("oauth.start_failed", { provider: "microsoft", error: e });
    return redirectResponse("/login?error=failed&provider=microsoft");
  }
}
