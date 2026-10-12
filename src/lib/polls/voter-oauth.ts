// OWNER: polls-core. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// poll_freebusy OAuth intent (P3, ARCHITECTURE section 10.4): a voter connects Google or Microsoft once to overlay their
// busy times on the poll grid; tokens are never persisted. Foundation stub: 404.
import "server-only";
import type { OAuthCallbackContext } from "@/lib/auth/oauth/types";

export async function handleVoterFreeBusyCallback(ctx: OAuthCallbackContext): Promise<Response> {
  void ctx;
  return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
