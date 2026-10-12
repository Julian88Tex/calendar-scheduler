// OWNER: booking-pages. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// GET /booking/{inviteeId}/event.ics (SPEC BK-22, CAL-12): the invitee's ICS download (provider iCal UID in calendar
// invitation mode). Foundation stub: 404 for unknown invitees, 501 otherwise.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { invitees } from "@/db/schema";
import { json } from "@/lib/http";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ inviteeId: string }> }): Promise<Response> {
  const { inviteeId } = await ctx.params;
  if (!isUuid(inviteeId)) return json({ error: "not_found", message: "Not found" }, { status: 404 });
  const db = await getDb();
  const [row] = await db.select({ id: invitees.id }).from(invitees).where(eq(invitees.id, inviteeId)).limit(1);
  if (!row) return json({ error: "not_found", message: "Not found" }, { status: 404 });
  return json({ error: "not_configured", message: "Calendar downloads are not available yet." }, { status: 501 });
}
