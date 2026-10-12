// POST /api/public/bookings/{reservationId}/verify (SPEC BK-17, BK-31, booking-core).
//   { code, rememberDevice?, embed? }  checks the 6-digit code (10 minutes, 5 attempts) and completes the booking:
//                                      { ok: true, inviteeId, scheduledEventId, redirectUrl?, trustedDevice? }; with
//                                      rememberDevice the "Remember this device" cookie is set (embed-safe attributes
//                                      when embed is true) and returned for the localStorage fallback.
//   { resend: true }                   sends a new code (at most 5 per hour): { ok: true, resent: true, email }.
// Errors: { ok: false, code: invalid_code | expired | too_many_attempts | not_found | slot_unavailable |
// already_booked | link_used, message } ("That code isn't correct. Try again.").
import { assertVerifyRateLimit, parseTrustedDeviceCookie, resendReservationCode, TRUSTED_DEVICE_COOKIE, verifyReservationCode, verifyRequestSchema } from "@/lib/booking";
import { appendEmbedSafeCookie, readEmbedSafeCookie } from "@/lib/cookies";
import { AppError } from "@/lib/errors";
import { assertSameOrigin, getClientIp, json, readJsonBody, route } from "@/lib/http";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ reservationId: string }> };

const STATUS = {
  invalid_code: 400,
  expired: 410,
  too_many_attempts: 429,
  not_found: 404,
  slot_unavailable: 409,
  already_booked: 409,
  link_used: 409,
} as const;

export const POST = route<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const { reservationId } = await ctx.params;
  if (!isUuid(reservationId)) throw new AppError("not_found", "This booking could not be found.");
  await assertVerifyRateLimit(getClientIp(request));
  const body = await readJsonBody(request, verifyRequestSchema);

  if (body.resend) {
    const r = await resendReservationCode(reservationId);
    return json({ ok: true, resent: true, email: r.email });
  }
  if (!body.code) {
    return json({ ok: false, code: "invalid_code", message: "Enter the 6-digit code." }, { status: 400 });
  }
  const existing = parseTrustedDeviceCookie(readEmbedSafeCookie(request, TRUSTED_DEVICE_COOKIE));
  const result = await verifyReservationCode(reservationId, body.code, {
    rememberDevice: body.rememberDevice === true,
    existingDeviceTokens: existing,
  });
  if (!result.ok) return json(result, { status: STATUS[result.code] });
  const response = json(result);
  if (result.trustedDevice) {
    appendEmbedSafeCookie(response, result.trustedDevice.cookieName, result.trustedDevice.value, {
      maxAgeSeconds: result.trustedDevice.maxAgeSeconds,
      embed: body.embed === true,
    });
  }
  return response;
});
