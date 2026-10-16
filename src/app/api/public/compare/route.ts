// GET    /api/public/compare   The visitor's compare connection (booking page "Compare with my calendar"):
//                              { connected: false } or { connected: true, email, expiresAt, events, calendars: [{ id,
//                              name, color, primary, selected }] } (events: the visitor allowed reading event names). The token lives only in the visitor's sealed cookie
//                              (src/lib/compare/session.ts); a token Google rejects ends the connection.
// DELETE /api/public/compare   "Disconnect": deletes the cookie -> { ok: true }.
import { CompareTokenError, listCompareCalendars } from "@/lib/compare/google";
import { clearCompareCookie, readCompareSession } from "@/lib/compare/session";
import { assertSameOrigin, json, route } from "@/lib/http";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const session = await readCompareSession(request);
  if (!session) return json({ connected: false });
  try {
    const calendars = await listCompareCalendars(session);
    return json({ connected: true, email: session.email, expiresAt: new Date(session.expiresAt).toISOString(), events: Boolean(session.events), calendars });
  } catch (e) {
    if (e instanceof CompareTokenError) return clearCompareCookie(json({ connected: false, expired: true }));
    log.warn("compare.calendar_list_failed", { error: e });
    return json({ error: "internal", message: "We couldn't load your calendars." }, { status: 502 });
  }
});

export const DELETE = route(async (request) => {
  assertSameOrigin(request);
  return clearCompareCookie(json({ ok: true }));
});
