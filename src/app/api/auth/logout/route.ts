// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// POST /api/auth/logout (SPEC AU-05, GEN-17): revokes the current session server side (the old cookie value stops
// working), clears the cookie, audits user.logout and redirects to /login (303). Same-origin only (CSRF, ARCHITECTURE
// 18.5); a GET never logs anyone out.
import { auditAuth } from "@/lib/auth/flows/audit";
import { requestMetaFrom } from "@/lib/auth/flows/request-context";
import { destroySession, getSession } from "@/lib/auth/session";
import { apiError, assertSameOrigin } from "@/lib/http";
import { log } from "@/lib/logger";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
  } catch (e) {
    return apiError(e);
  }
  const current = await getSession().catch(() => null);
  await destroySession();
  if (current && !current.session.twoFactorPending) {
    await auditAuth("user.logout", { user: current.user, meta: requestMetaFrom(request) }).catch((e: unknown) =>
      log.warn("auth.logout_audit_failed", { error: e }),
    );
  }
  return new Response(null, { status: 303, headers: { Location: absoluteUrl("/login"), "Cache-Control": "no-store" } });
}
