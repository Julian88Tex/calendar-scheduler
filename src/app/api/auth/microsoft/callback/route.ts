// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// GET /api/auth/microsoft/callback (ARCHITECTURE sections 10.4 and 18.4): validates the state cookie, exchanges the code,
// decodes the id token and dispatches the intent (src/lib/auth/oauth/intents.ts). One redirect URI per provider for
// every intent: {APP_URL}/api/auth/microsoft/callback.
import { handleOAuthCallback } from "@/lib/auth/oauth/flow";
import { redirectResponse } from "@/lib/auth/oauth/redirects";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleOAuthCallback(request, "microsoft");
  } catch (e) {
    log.error("oauth.callback_failed", { provider: "microsoft", error: e });
    return redirectResponse("/login?error=failed&provider=microsoft");
  }
}
