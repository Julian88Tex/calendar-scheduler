// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// GET /api/auth/microsoft/start?intent=login|signup|connect_calendar|poll_freebusy|link_login_method|accept_invitation&next=...
// (ARCHITECTURE sections 10.4 and 18.4): stores intent, PKCE verifier, state and returnTo in the 10 minute state cookie
// and redirects to Microsoft. Foundation stub: answers "not configured".
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return json({ error: "not_configured", message: "Sign in with Microsoft is not configured on this server." }, { status: 501 });
}
