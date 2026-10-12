// Services behind the public booking endpoints (SPEC BK-31): the slots month view and the invitee booking
// submission. The route handlers in src/app/api/public/** stay thin (parse, rate limit, call these, respond).
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { invitees } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { isValidTimeZone } from "@/lib/slots";
import { dayFromIso, isoFromDay, zoneClock } from "@/lib/slots/zone";
import { now as clockNow } from "@/lib/time/now";
import { computeAvailability, hostSpecsOf, MAX_RANGE_DAYS } from "./availability";
import { createBooking } from "./create";
import { firstAvailableDate, groupSlotsByLocalDate, localDateRange, localDateSpan, type SlotDays } from "./format";
import { checkBookingBot } from "./protect";
import type { BookingRequest, SlotsQuery } from "./schemas";
import { loadEventType, resolveTargetByCode } from "./target";
import { candidateOut } from "./troubleshoot";
import type { BookingTarget, CreateBookingInput, CreateBookingResult, TroubleshootCandidate } from "./types";
import { MESSAGES } from "./validate";

export type SlotsResponse = {
  timeZone: string;
  durationMinutes: number;
  days: SlotDays;
  firstAvailableDate?: string;
  /** End of the booking window (ISO UTC), null when unlimited. */
  windowEnd: string | null;
  /** Owners with troubleshoot=1: every candidate start per local date with its reasons (SCH-21, BK-24). */
  troubleshoot?: { days: Record<string, TroubleshootCandidate[]> };
};

const MAX_LOOKAHEAD_DAYS = 366;

/** The booking target of a slots request: an event type id or a /d/{code} link code. */
export async function slotsTarget(param: string): Promise<BookingTarget | null> {
  if (isUuid(param)) {
    const eventType = await loadEventType(param);
    return eventType ? { kind: "event_type", eventType } : null;
  }
  return resolveTargetByCode(param);
}

function isHostOf(target: BookingTarget, userId: string | null): boolean {
  if (!userId) return false;
  return target.eventType.ownerUserId === userId || hostSpecsOf(target.eventType).some((h) => h.userId === userId);
}

/**
 * GET /api/public/slots (BK-31): slots of [start, end] (local dates in `tz`, at most 62 days) grouped by the zone's
 * local dates (SCH-22). With first=1 and no slots, looks ahead (up to a year, within the booking window) for the first
 * date with availability. troubleshoot=1 is for hosts of the event type only.
 */
export async function publicSlots(q: SlotsQuery, viewer: { userId: string } | null): Promise<SlotsResponse> {
  if (!isValidTimeZone(q.tz)) throw new AppError("validation", "Choose a valid time zone.", { fieldErrors: { tz: ["Choose a valid time zone."] } });
  if (localDateSpan(q.start, q.end) > MAX_RANGE_DAYS) {
    throw new AppError("validation", `Ask for at most ${MAX_RANGE_DAYS} days.`, { fieldErrors: { end: [`Ask for at most ${MAX_RANGE_DAYS} days.`] } });
  }
  const target = await slotsTarget(q.target);
  if (!target) throw new AppError("not_found", MESSAGES.notFound);
  const viewerIsHost = isHostOf(target, viewer?.userId ?? null);
  const troubleshoot = q.troubleshoot === "1" || q.troubleshoot === "true";
  if (troubleshoot && !viewerIsHost) throw new AppError("forbidden", "Only the host can troubleshoot this page.");
  if (!target.eventType.active && !viewerIsHost) throw new AppError("not_found", MESSAGES.notAvailable);

  let ignoreInviteeId: string | undefined;
  if (q.reschedule) {
    const db = await getDb();
    const [inv] = await db
      .select({ id: invitees.id })
      .from(invitees)
      .where(and(eq(invitees.id, q.reschedule), eq(invitees.eventTypeId, target.eventType.id), eq(invitees.status, "active")))
      .limit(1);
    if (!inv) throw new AppError("not_found", MESSAGES.notReschedulable);
    ignoreInviteeId = inv.id;
  }

  const now = clockNow();
  const range = localDateRange(q.start, q.end, q.tz);
  const run = (start: Date, end: Date, withDiagnostics: boolean) =>
    computeAvailability({
      target,
      start,
      end,
      durationMinutes: q.duration,
      now,
      troubleshoot: withDiagnostics,
      diagnoseOutsideHours: withDiagnostics,
      ignoreInviteeId,
      freshness: "page",
    });
  const result = await run(range.start, range.end, troubleshoot);
  const durationMinutes = result.prepared?.durationMinutes ?? (q.duration ?? target.eventType.durationMinutes);
  const days = groupSlotsByLocalDate(result.slots, q.tz);
  const out: SlotsResponse = {
    timeZone: q.tz,
    durationMinutes,
    days,
    windowEnd: result.windowEnd === null ? null : new Date(result.windowEnd).toISOString(),
  };
  const first = firstAvailableDate(days);
  if (first) out.firstAvailableDate = first;
  else if (q.first === "1" || q.first === "true") {
    const found = await lookAhead(q, result.windowEnd, (s, e) => run(s, e, false));
    if (found) out.firstAvailableDate = found;
  }
  if (troubleshoot) {
    const byDay: Record<string, TroubleshootCandidate[]> = {};
    const clock = zoneClock(q.tz);
    for (const d of result.diagnostics ?? []) {
      const day = isoFromDay(clock.localDay(d.start));
      (byDay[day] ??= []).push(candidateOut(d, viewer!.userId, true));
    }
    out.troubleshoot = { days: byDay };
  }
  return out;
}

async function lookAhead(
  q: SlotsQuery,
  windowEnd: number | null,
  run: (s: Date, e: Date) => Promise<{ slots: { start: number }[] }>,
): Promise<string | null> {
  let startDay = dayFromIso(q.end) + 1;
  const lastDay = dayFromIso(q.start) + MAX_LOOKAHEAD_DAYS;
  const clock = zoneClock(q.tz);
  while (startDay <= lastDay) {
    const endDay = Math.min(startDay + MAX_RANGE_DAYS - 1, lastDay);
    const s = new Date(clock.startOfDay(startDay));
    if (windowEnd !== null && s.getTime() >= windowEnd) return null;
    const e = new Date(clock.startOfDay(endDay + 1));
    const r = await run(s, e);
    if (r.slots.length > 0) return isoFromDay(clock.localDay(r.slots[0]!.start));
    startDay = endDay + 1;
  }
  return null;
}

export type PublicBookingOutcome = { status: number; body: CreateBookingResult };

const STATUS: Record<Extract<CreateBookingResult, { ok: false }>["code"], number> = {
  validation: 400,
  blocked: 400,
  not_found: 404,
  slot_unavailable: 409,
  already_booked: 409,
  link_used: 409,
  verification_required: 202,
  payment_required: 202,
};

/** POST /api/public/bookings (BK-31): bot checks, then createBooking as the invitee. */
export async function publicBooking(
  body: BookingRequest,
  ctx: { ip: string | null; trustedDeviceTokens: string[] },
): Promise<PublicBookingOutcome> {
  const bot = await checkBookingBot({ honeypot: body.website, formToken: body.formToken, turnstileToken: body.turnstileToken, ip: ctx.ip });
  if (!bot.ok) return { status: 400, body: { ok: false, code: "blocked", message: MESSAGES.botBlocked } };
  const input: CreateBookingInput = {
    target: body.target,
    start: body.start,
    durationMinutes: body.durationMinutes,
    invitee: {
      name: body.invitee.name ?? undefined,
      firstName: body.invitee.firstName ?? undefined,
      lastName: body.invitee.lastName ?? undefined,
      email: body.invitee.email,
      timezone: body.invitee.timezone,
      detectedTimezone: body.invitee.detectedTimezone ?? null,
      timeFormat: body.invitee.timeFormat ?? null,
      locale: body.invitee.locale ?? undefined,
      textReminderNumber: body.invitee.textReminderNumber ?? null,
      marketingConsent: body.invitee.marketingConsent,
    },
    guests: body.guests,
    locationAnswer: body.locationAnswer ?? undefined,
    answers: body.answers,
    tracking: Object.fromEntries(Object.entries(body.tracking ?? {}).filter(([, v]) => typeof v === "string" && v)) as CreateBookingInput["tracking"],
    routingFormSubmissionId: body.routingFormSubmissionId ?? null,
    clientRequestId: body.clientRequestId,
    verification: body.verification ?? null,
    actor: { type: "invitee" },
  };
  const result = await createBooking(input, { ip: ctx.ip ?? undefined, trustedDeviceTokens: ctx.trustedDeviceTokens });
  return { status: result.ok ? 200 : STATUS[result.code], body: result };
}
