// OWNER: conferencing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// GET /events/{scheduledEventId}/join (SPEC VID-11): redirects (302) to the provider join URL when available; while
// processing shows "Your meeting link is being prepared." (auto refresh); canceled meetings show "This meeting was
// canceled."; other locations show their details. Foundation stub: a minimal version of exactly that.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { scheduledEvents } from "@/db/schema";
import { escapeHtml } from "@/lib/html";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

function page(message: string, refresh = false): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${
    refresh ? '<meta http-equiv="refresh" content="5">' : ""
  }<meta name="robots" content="noindex"><title>Join meeting</title></head><body style="font-family:Arial,sans-serif;color:#0a2540;padding:48px;text-align:center"><p>${escapeHtml(message)}</p></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("Not Found", { status: 404 });
  const db = await getDb();
  const [meeting] = await db
    .select({ status: scheduledEvents.status, location: scheduledEvents.location })
    .from(scheduledEvents)
    .where(eq(scheduledEvents.id, id))
    .limit(1);
  if (!meeting) return new Response("Not Found", { status: 404 });
  if (meeting.status === "canceled") return page("This meeting was canceled.");
  const loc = meeting.location;
  if (loc?.joinUrl && /^https:\/\//.test(loc.joinUrl)) {
    return new Response(null, { status: 302, headers: { Location: loc.joinUrl, "Cache-Control": "no-store" } });
  }
  if (loc?.status === "processing" || loc?.status === "initiated") {
    return page("Your meeting link is being prepared. This page will refresh automatically.", true);
  }
  return page(loc?.location ?? "This meeting has no online meeting link.");
}
