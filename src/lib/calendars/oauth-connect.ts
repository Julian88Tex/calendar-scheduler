// OWNER: calendar-integrations. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// connect_calendar OAuth intent (ARCHITECTURE section 10.4): the shared Google and Microsoft callbacks (foundation-auth)
// dispatch here after the code exchange. Foundation stub: redirect to the calendar settings page with "not available".
import "server-only";
import type { OAuthCallbackContext } from "@/lib/auth/oauth/types";
import { absoluteUrl } from "@/lib/url";

export async function handleConnectCallback(ctx: OAuthCallbackContext): Promise<Response> {
  const url = new URL(absoluteUrl("/app/availability/calendar-settings"));
  url.searchParams.set("error", "not_available");
  url.searchParams.set("provider", ctx.provider);
  return Response.redirect(url.toString(), 303);
}
