// POST /api/public/bookings (SPEC BK-31, booking-core): the invitee booking submission for embeds and scripts, same
// contract as the booking pages' server action. Answers { ok: true, inviteeId, scheduledEventId, redirectUrl? } or
// { ok: false, code, message, fieldErrors?, reservationId? } with code slot_unavailable | validation | blocked |
// verification_required | payment_required | already_booked | link_used | not_found. Same-origin only (the booking
// page, also inside an embed iframe, runs on this origin); bot checks (BK-18) and rate limits (10 per IP per 10
// minutes per event type, 30 per IP per hour) apply. Verification continues at /api/public/bookings/{id}/verify.
import { assertBookingRateLimit, bookingRequestSchema, parseTrustedDeviceCookie, publicBooking, TRUSTED_DEVICE_COOKIE } from "@/lib/booking";
import { readEmbedSafeCookie } from "@/lib/cookies";
import { assertSameOrigin, getClientIp, json, readJsonBody, route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const body = await readJsonBody(request, bookingRequestSchema);
  const ip = getClientIp(request);
  const t = body.target;
  await assertBookingRateLimit(ip, t.eventTypeId ?? t.code ?? `${t.handle ?? ""}/${t.eventSlug ?? ""}`);
  const tokens = parseTrustedDeviceCookie(readEmbedSafeCookie(request, TRUSTED_DEVICE_COOKIE));
  const outcome = await publicBooking(body, { ip, trustedDeviceTokens: tokens });
  return json(outcome.body, { status: outcome.status });
});
