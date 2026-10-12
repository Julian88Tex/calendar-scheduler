// OWNER: booking-pages.
//
// GET /booking/{inviteeId}/event.ics (SPEC BK-22, CAL-12, NT-06): the invitee's calendar file. Same UID as the emailed
// invites, or the provider's iCal UID in calendar invitation mode, so importing it updates the event the invitee already
// holds instead of adding a copy; canceled bookings answer a CANCEL file. Capability URL (the invitee id), noindex,
// never cached.
import { loadInviteeForIcs } from "@/components/booking/server/confirmation";
import { buildMeetingIcs, icsContentType } from "@/lib/email";
import { json } from "@/lib/http";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

const NOT_FOUND = { error: "not_found", message: "This booking could not be found." };

export async function GET(_request: Request, ctx: { params: Promise<{ inviteeId: string }> }): Promise<Response> {
  const { inviteeId } = await ctx.params;
  try {
    const invitee = await loadInviteeForIcs(inviteeId);
    if (!invitee) return json(NOT_FOUND, { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } });
    const method = invitee.status === "active" && invitee.eventStatus === "active" ? "REQUEST" : "CANCEL";
    const ics = await buildMeetingIcs({ scheduledEventId: invitee.scheduledEventId, inviteeId: invitee.id, method, audience: "invitee" });
    if (!ics) return json(NOT_FOUND, { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } });
    const filename = (ics.filename || "invite.ics").replace(/[^\w.-]+/g, "_");
    return new Response(ics.content, {
      status: 200,
      headers: {
        "Content-Type": icsContentType(ics.method),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (e) {
    log.error("booking.ics_failed", { error: e });
    return json({ error: "internal", message: "Something went wrong. Try again." }, { status: 500 });
  }
}
