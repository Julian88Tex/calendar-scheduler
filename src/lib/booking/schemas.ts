// Zod schemas of the public booking endpoints (BK-31) and the booking pages' server action input. Client and server
// safe (zod only). Field-level rules against the event type (questions, locations, guests) live in validate.ts.
import { z } from "zod";

const text = (max: number) => z.string().max(max);
const optText = (max: number) => z.string().max(max).optional().nullable();

/** GET /api/public/slots query (BK-31). Dates are local dates in `tz`, inclusive, at most 62 days. */
export const slotsQuerySchema = z
  .object({
    target: z.string().trim().min(1, "Missing target").max(100),
    start: z.iso.date("Enter a date like 2026-10-14"),
    end: z.iso.date("Enter a date like 2026-10-14"),
    tz: z.string().trim().min(1).max(64),
    duration: z.coerce.number().int().min(1).max(720).optional(),
    troubleshoot: z.enum(["0", "1", "true", "false"]).optional(),
    reschedule: z.uuid().optional(),
    first: z.enum(["0", "1", "true", "false"]).optional(),
  })
  .refine((q) => q.end >= q.start, { message: "End must be on or after start", path: ["end"] });

export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

const answerSchema = z.object({
  questionId: z.string().max(64),
  value: z.union([text(10_001), z.array(text(10_001)).max(50)]),
});

const trackingSchema = z
  .object({
    utmSource: optText(255),
    utmMedium: optText(255),
    utmCampaign: optText(255),
    utmContent: optText(255),
    utmTerm: optText(255),
    salesforceUuid: optText(255),
  })
  .partial()
  .optional();

/** POST /api/public/bookings body (the invitee booking contract; never carries host, poll or reschedule context). */
export const bookingRequestSchema = z.object({
  target: z.object({
    kind: z.enum(["event_type", "single_use", "one_off", "shared"]),
    eventTypeId: z.uuid().optional(),
    code: z.string().trim().min(1).max(100).optional(),
    handle: z.string().trim().min(1).max(100).optional(),
    eventSlug: z.string().trim().min(1).max(200).optional(),
  }),
  start: z.string().trim().min(1).max(40),
  durationMinutes: z.number().int().min(1).max(720).optional(),
  invitee: z.object({
    name: optText(300),
    firstName: optText(300),
    lastName: optText(300),
    email: text(320),
    timezone: text(64),
    detectedTimezone: optText(64),
    timeFormat: z.enum(["12h", "24h"]).optional().nullable(),
    locale: optText(16),
    textReminderNumber: optText(40),
    marketingConsent: z.boolean().optional(),
  }),
  guests: z.array(text(320)).max(25).optional(),
  locationAnswer: z.object({ configId: z.string().max(64), value: optText(1000) }).optional().nullable(),
  answers: z.array(answerSchema).max(50).optional(),
  tracking: trackingSchema,
  /** The persona of the page (?for=), see CreateBookingInput.persona. */
  persona: z.string().trim().max(40).optional().nullable(),
  routingFormSubmissionId: z.uuid().optional().nullable(),
  clientRequestId: z.string().trim().min(8).max(100).optional(),
  verification: z.object({ reservationId: z.uuid(), code: z.string().trim().max(12) }).optional().nullable(),
  /** BK-18 honeypot (must stay empty). */
  website: z.string().max(500).optional().nullable(),
  /** BK-18 signed render timestamp. */
  formToken: z.string().max(200).optional().nullable(),
  turnstileToken: z.string().max(4096).optional().nullable(),
  embed: z.boolean().optional(),
});

export type BookingRequest = z.infer<typeof bookingRequestSchema>;

/** POST /api/public/bookings/{reservationId}/verify body. */
export const verifyRequestSchema = z.object({
  code: z.string().trim().max(12).optional(),
  rememberDevice: z.boolean().optional(),
  resend: z.boolean().optional(),
  embed: z.boolean().optional(),
});

export type VerifyRequest = z.infer<typeof verifyRequestSchema>;
