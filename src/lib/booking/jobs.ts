// OWNER: booking-core. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Job handlers of this module, merged by src/lib/jobs/registry.ts (ARCHITECTURE section 12.2). Keys are prefixed with
// the module domain:
//   booking.reservation_expire        marks a hold expired once its time is up (enqueued per reservation; also a
//                                     periodic sweep without a reservation id)
//   booking.send_verification_code    renders and sends the BK-17 code email (the code travels encrypted)
import "server-only";
import { and, eq, lte } from "drizzle-orm";
import { bookingReservations, verificationCodes } from "@/db/schema";
import { decryptOrNull } from "@/lib/crypto";
import { emailBrandForUser, sendEmail } from "@/lib/email";
import type { JobHandlers, PeriodicJob } from "@/lib/jobs/types";
import { PermanentJobError } from "@/lib/jobs/types";
import { formatMeetingWhen, hour12For } from "@/lib/time/format";
import { renderVerificationCodeEmail } from "./emails";
import { loadEventType } from "./target";
import type { CreateBookingInput } from "./types";

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export const handlers: JobHandlers = {
  "booking.reservation_expire": async (payload: { reservationId?: unknown } | null, ctx) => {
    const id = payload?.reservationId;
    const where = isId(id)
      ? and(eq(bookingReservations.id, id), eq(bookingReservations.status, "pending"), lte(bookingReservations.expiresAt, ctx.now))
      : and(eq(bookingReservations.status, "pending"), lte(bookingReservations.expiresAt, ctx.now));
    const rows = await ctx.db
      .update(bookingReservations)
      .set({ status: "expired", updatedAt: ctx.now })
      .where(where)
      .returning({ id: bookingReservations.id });
    return { result: { expired: rows.length } };
  },

  "booking.send_verification_code": async (
    payload: { codeId?: unknown; reservationId?: unknown; email?: unknown; codeEnc?: unknown } | null,
    ctx,
  ) => {
    if (!payload || !isId(payload.codeId) || !isId(payload.reservationId) || typeof payload.email !== "string" || typeof payload.codeEnc !== "string") {
      throw new PermanentJobError("invalid payload");
    }
    const [code] = await ctx.db.select().from(verificationCodes).where(eq(verificationCodes.id, payload.codeId)).limit(1);
    // A newer code (resend) or a successful verification makes this email pointless.
    if (!code || code.consumedAt) return { result: { skipped: "consumed" } };
    const [res] = await ctx.db.select().from(bookingReservations).where(eq(bookingReservations.id, payload.reservationId)).limit(1);
    if (!res || res.status !== "pending") return { result: { skipped: "reservation" } };
    const plain = await decryptOrNull(payload.codeEnc);
    if (!plain || !/^\d{6}$/.test(plain)) throw new PermanentJobError("code not readable");
    const et = await loadEventType(res.eventTypeId, ctx.db);
    if (!et) return { result: { skipped: "event_type" } };
    const hostId = et.organizerUserId ?? et.ownerUserId ?? et.hosts[0]?.userId ?? null;
    const brand = await emailBrandForUser(hostId, ctx.db);
    const hostRow = hostId ? await ctx.db.query.users.findFirst({ where: (u, { eq: e }) => e(u.id, hostId), columns: { name: true } }) : null;
    const input = res.payload as unknown as Partial<CreateBookingInput>;
    const zone = typeof input?.invitee?.timezone === "string" ? input.invitee.timezone : "UTC";
    let when: string | null = null;
    try {
      when = formatMeetingWhen(res.startAt, res.endAt, zone, "en", hour12For(input?.invitee?.timeFormat ?? null));
    } catch {
      when = null;
    }
    const email = renderVerificationCodeEmail({ code: plain, eventName: et.name, hostName: hostRow?.name ?? "your host", when, brand });
    const sent = await sendEmail({
      to: [payload.email],
      subject: email.subject,
      html: email.html,
      text: email.text,
      template: "booking.verification_code",
      category: "transactional",
      idempotencyKey: `booking.verification_code:${payload.codeId}`,
      related: { organizationId: et.organizationId },
    });
    return { result: { emailId: sent.id, status: sent.status } };
  },
};

export const periodic: PeriodicJob[] = [{ type: "booking.reservation_expire", everyMinutes: 15 }];
