"use server";
// Booking page server actions (SPEC BK-33 "Show times you're free"): the signed-in viewer's own busy times for the
// visible month (conflict calendars, app meetings and holds, through booking-core getBusyForUsers on the viewer's own
// id), as bare ranges: no titles leave the server and the host's data is never involved.
import { z } from "zod";
import { runAction } from "@/lib/actions";
import { getBusyForUsers } from "@/lib/booking";

const ViewerBusyInput = z
  .object({ start: z.iso.datetime(), end: z.iso.datetime() })
  .refine((v) => Date.parse(v.end) > Date.parse(v.start), { message: "End must be after start", path: ["end"] })
  .refine((v) => Date.parse(v.end) - Date.parse(v.start) <= 45 * 86_400_000, { message: "Ask for at most 45 days", path: ["end"] });

export async function getViewerBusy(raw: unknown) {
  return runAction(ViewerBusyInput, raw, async (input, { actor }) => {
    const busy = await getBusyForUsers({ userId: actor.user.id, organizationId: actor.orgId }, [actor.user.id], new Date(input.start), new Date(input.end));
    return (busy[actor.user.id] ?? []).map((b) => ({ start: b.start, end: b.end }));
  });
}
