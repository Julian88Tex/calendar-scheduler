"use server";
// Invitee reschedule (SPEC CR-03, CR-04, CR-08, SCH-23, SCH-24, GEN-08): the "Update Event" form of
// /reschedulings/{inviteeId}/{start} posts here. The invitee id is the capability; lifecycle-core's rescheduleInvitee
// applies the change rules, books the new time through booking-core (normal availability, the moved meeting ignored,
// no email verification) and cancels and links the old invitee in the same transaction; the reschedule emails go out
// right after the response. Thin: parse, rate limit like a booking (BK-18), call the service, map its answer.
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { invitees } from "@/db/schema";
import type { RescheduleOutcome } from "@/components/lifecycle/lib/outcome";
import { rescheduleOutcomeOf } from "@/components/lifecycle/lib/outcome";
import { runAction } from "@/lib/actions";
import { assertBookingRateLimit } from "@/lib/booking";
import { bookingRequestSchema } from "@/lib/booking/schemas";
import { getClientIp } from "@/lib/http";
import lifecycleMessages from "@/lib/i18n/messages/en/lifecycle";
import { rescheduleInvitee } from "@/lib/lifecycle";

const RescheduleInput = z.object({
  inviteeId: z.uuid(),
  start: z.string().trim().min(1).max(40),
  durationMinutes: z.number().int().min(1).max(720).optional(),
  reason: z.string().max(2000, lifecycleMessages.changes.reasonTooLong).optional().nullable(),
  invitee: bookingRequestSchema.shape.invitee,
  guests: z.array(z.string().max(320)).max(25).optional(),
  locationAnswer: bookingRequestSchema.shape.locationAnswer,
  answers: bookingRequestSchema.shape.answers,
  clientRequestId: z.string().trim().min(8).max(100),
});

function orUndefined<T>(v: T | null | undefined): T | undefined {
  return v === null ? undefined : v;
}

export async function rescheduleInviteeAction(raw: unknown) {
  return runAction(
    RescheduleInput,
    raw,
    async (input): Promise<RescheduleOutcome> => {
      const ip = getClientIp(await headers());
      const db = await getDb();
      const [row] = await db.select({ eventTypeId: invitees.eventTypeId }).from(invitees).where(eq(invitees.id, input.inviteeId)).limit(1);
      if (!row) return { type: "blocked", message: lifecycleMessages.changes.notReschedulable };
      await assertBookingRateLimit(ip, row.eventTypeId);
      const i = input.invitee;
      const result = await rescheduleInvitee(
        {
          inviteeId: input.inviteeId,
          start: input.start,
          durationMinutes: input.durationMinutes,
          reason: input.reason?.trim() || null,
          actor: { type: "invitee" },
          // Explicit keys replace the stored values (a full name form clears the stored first and last names).
          invitee: {
            name: orUndefined(i.name),
            firstName: orUndefined(i.firstName),
            lastName: orUndefined(i.lastName),
            email: i.email,
            timezone: i.timezone,
            detectedTimezone: i.detectedTimezone ?? null,
            timeFormat: i.timeFormat ?? null,
            locale: orUndefined(i.locale),
            marketingConsent: i.marketingConsent,
          },
          guests: input.guests ?? [],
          locationAnswer: input.locationAnswer ? { configId: input.locationAnswer.configId, value: input.locationAnswer.value ?? null } : undefined,
          answers: input.answers ?? [],
          clientRequestId: input.clientRequestId,
        },
        { ip: ip ?? undefined },
      );
      return rescheduleOutcomeOf(result);
    },
    { auth: "none" },
  );
}
