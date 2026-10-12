// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// GET /api/auth/google/callback (ARCHITECTURE sections 10.4 and 18.4): validates state, exchanges the code, decodes the id
// token and dispatches the intent (src/lib/auth/oauth/intents.ts). One redirect URI per provider for every intent.
// Foundation stub: answers "not configured".
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return json({ error: "not_configured", message: "Sign in with Google is not configured on this server." }, { status: 501 });
}
