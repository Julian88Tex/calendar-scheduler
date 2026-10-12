// GET /api/public/slots?target={eventTypeId|link code}&start=YYYY-MM-DD&end=YYYY-MM-DD&tz=Area/City&duration=30
// (SPEC BK-31, booking-core). Answers { timeZone, durationMinutes, days: { "YYYY-MM-DD": [{ start, remaining }] },
// firstAvailableDate?, windowEnd } grouped by the requested zone's local dates (a locked time zone event: its locked
// zone, returned as timeZone); at most 62 days; Cache-Control no-store. Optional: troubleshoot=1 (hosts only: reason
// codes per candidate), reschedule={inviteeId} (SCH-24), first=1 (look ahead for the first available date when the
// range has none). 60 requests per IP per minute and 600 per hour (429 beyond), checked before anything else; a range
// outside the booking window answers without loading busy times or calling calendar providers.
import { getCurrentUser } from "@/lib/auth/session";
import { assertSlotsRateLimit, publicSlots, slotsQuerySchema } from "@/lib/booking";
import { AppError } from "@/lib/errors";
import { getClientIp, json, route, zodFieldErrors } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  await assertSlotsRateLimit(getClientIp(request));
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = slotsQuerySchema.safeParse(params);
  if (!parsed.success) throw new AppError("validation", { fieldErrors: zodFieldErrors(parsed.error) });
  const wantsTroubleshoot = parsed.data.troubleshoot === "1" || parsed.data.troubleshoot === "true";
  const user = wantsTroubleshoot ? await getCurrentUser() : null;
  const body = await publicSlots(parsed.data, user ? { userId: user.id } : null);
  return json(body, { headers: { "Cache-Control": "no-store, max-age=0" } });
});
