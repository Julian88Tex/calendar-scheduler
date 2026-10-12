// GET /api/public/bookings/{reservationId}/status (SPEC BK-31, PAY-03 embed polling, booking-core): the state of a
// payment or verification hold, { status: pending | completed | expired | canceled, kind, inviteeId, expiresAt }.
// The reservation id is a capability (random uuid); nothing personal is returned. Cache-Control no-store.
import { getReservationStatus } from "@/lib/booking";
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ reservationId: string }> };

export const GET = route<Ctx>(async (_request, ctx) => {
  const { reservationId } = await ctx.params;
  if (!isUuid(reservationId)) throw new AppError("not_found", "This booking could not be found.");
  const status = await getReservationStatus(reservationId);
  if (!status) throw new AppError("not_found", "This booking could not be found.");
  return json(status);
});
