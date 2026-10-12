// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// POST /api/auth/logout (SPEC AU-05): revokes the current session server side, clears the cookie and redirects to
// /login (303). Same-origin only (CSRF, ARCHITECTURE 18.5). Foundation: a complete minimal implementation.
import { destroySession } from "@/lib/auth/session";
import { apiError, assertSameOrigin } from "@/lib/http";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
  } catch (e) {
    return apiError(e);
  }
  await destroySession();
  return new Response(null, { status: 303, headers: { Location: absoluteUrl("/login"), "Cache-Control": "no-store" } });
}
