// Booking creation (ARCHITECTURE section 9; SPEC SCH-14, SCH-19, SCH-20, SCH-24, BK-17, BK-19, BK-28, CR-04, OO-04):
// createBooking, createReservation and completeReservation share one transaction shape:
//
//   1. lock order step 1: per-host advisory locks (every candidate host, sorted)
//   2. idempotency inside the lock (client request id; reservation id for completions)
//   3. lock order step 2: the invitee being rescheduled (FOR UPDATE), then at most one target row (the group slot, the
//      single-use link or one-off through links.consumeLinkInTx, or the poll through polls.markPollBookedInTx)
//   4. recheck of the exact slot with meetings and holds read inside the transaction and external busy fetched just
//      before it (submit freshness, 60 seconds)
//   5. inserts (scheduled event, hosts with buffered times and assigned_at, invitees, guests, activity), the reschedule
//      cancel and link, and publishEvent(booking.created | booking.rescheduled) in the same transaction
//   6. after the commit: runJobsAfterResponse for the event's subscriber jobs (provisioning and emails start at once)
import "server-only";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { isUniqueViolation } from "@/db/helpers";
import {
  blockedInvitees,
  bookingReservations,
  inviteeGuests,
  invitees,
  meetingActivity,
  routingFormSubmissions,
  routingForms,
  scheduledEventHosts,
  scheduledEvents,
  users,
} from "@/db/schema";
import type { LocationConfig, MeetingSettingsSnapshot, ResolvedLocation } from "@/db/types";
import { getDestinationCalendar, type ExternalBusyByUser } from "@/lib/calendars";
import { icsUid } from "@/lib/email";
import { AppError, isAppError } from "@/lib/errors";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
import { eventJobPattern, publishEvent, type Actor as DomainActor, type DomainEventMap } from "@/lib/events";
import { isUuid, newId } from "@/lib/ids";
import { enqueueJob, runJobsAfterResponse } from "@/lib/jobs";
import { consumeLinkInTx, LinkUsedError } from "@/lib/links";
import { log } from "@/lib/logger";
import { isPaymentsConfigured } from "@/lib/payments";
import { markPollBookedInTx } from "@/lib/polls";
import { selectHosts } from "@/lib/slots";
import type { Slot } from "@/lib/slots/types";
import { now as clockNow } from "@/lib/time/now";
import { appHost } from "@/lib/url";
import { candidateHostIds, computeAvailability, prefetchExternalBusy, type AvailabilityMode, type PreparedAvailability } from "./availability";
import { lockHostsInTx, lockInviteeForChangeInTx } from "./locks";
import { buildRedirectUrl } from "./redirect";
import { resolveRequestTarget } from "./target";
import type { BookingContext, BookingTarget, CreateBookingInput, CreateBookingResult, InviteeRow, ReservationStatus, VerifyCodeResult } from "./types";
import { MESSAGES, resolveLocation, validateBookingInput, type ValidatedBooking } from "./validate";
import {
  checkVerificationCode,
  issueVerificationCode,
  isTrustedDevice,
  rememberDevice,
  SEND_CODE_JOB,
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_MAX_AGE_SECONDS,
  VERIFICATION_RESENDS_PER_HOUR,
} from "./verification";

const MIN = 60_000;
/** Hold length of email verification and inline payment reservations (SCH-19). */
export const RESERVATION_HOLD_MS = 10 * MIN;

type Failure = Extract<CreateBookingResult, { ok: false }>;
type Success = Extract<CreateBookingResult, { ok: true }>;
type Actor = NonNullable<CreateBookingInput["actor"]>;

const fail = (code: Failure["code"], message: string, extra: Partial<Failure> = {}): Failure => ({ ok: false, code, message, ...extra });
const slotTaken = (): Failure => fail("slot_unavailable", MESSAGES.slotTaken);

/** Thrown inside a booking transaction to roll it back with a typed result. */
class BookingAbort extends Error {
  readonly result: Failure;
  constructor(result: Failure) {
    super(result.message);
    this.name = "BookingAbort";
    this.result = result;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers

/** The result of an existing invitee (idempotent replays, concurrent completions). */
export async function resultForInvitee(db: DbOrTx, inviteeId: string): Promise<Success | null> {
  const [row] = await db
    .select({ invitee: invitees, event: scheduledEvents })
    .from(invitees)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, invitees.scheduledEventId))
    .where(eq(invitees.id, inviteeId))
    .limit(1);
  if (!row) return null;
  const out: Success = { ok: true, inviteeId: row.invitee.id, scheduledEventId: row.event.id };
  const redirectUrl = await redirectFor(db, row.event, row.invitee);
  if (redirectUrl) out.redirectUrl = redirectUrl;
  return out;
}

async function redirectFor(
  db: DbOrTx,
  event: typeof scheduledEvents.$inferSelect,
  invitee: InviteeRow,
): Promise<string | undefined> {
  const snap = event.settingsSnapshot;
  if (snap.afterBooking !== "redirect" || !snap.redirectUrl) return undefined;
  if (!snap.redirectPassDetails) return buildRedirectUrl({ url: snap.redirectUrl, passDetails: false });
  const guests = await db
    .select({ email: inviteeGuests.email })
    .from(inviteeGuests)
    .where(and(eq(inviteeGuests.inviteeId, invitee.id), isNull(inviteeGuests.canceledAt)));
  const [assigned] = await db
    .select({ name: users.name })
    .from(scheduledEventHosts)
    .innerJoin(users, eq(users.id, scheduledEventHosts.userId))
    .where(and(eq(scheduledEventHosts.scheduledEventId, event.id), eq(scheduledEventHosts.userId, event.organizerUserId)))
    .limit(1);
  return buildRedirectUrl({
    url: snap.redirectUrl,
    passDetails: true,
    eventTypeName: event.name,
    eventTypeId: event.eventTypeId,
    start: event.startAt,
    end: event.endAt,
    zone: invitee.timezone ?? "UTC",
    guests: guests.map((g) => g.email),
    assignedTo: assigned?.name ?? null,
    invitee: {
      id: invitee.id,
      email: invitee.email,
      name: invitee.name,
      firstName: invitee.firstName,
      lastName: invitee.lastName,
      textReminderNumber: invitee.textReminderNumber,
      utmSource: invitee.utmSource,
      utmMedium: invitee.utmMedium,
      utmCampaign: invitee.utmCampaign,
      utmContent: invitee.utmContent,
      utmTerm: invitee.utmTerm,
    },
    answers: invitee.questionsAndAnswers.map((a) => a.answer),
    payment: null,
  });
}

async function findByClientRequestId(db: DbOrTx, clientRequestId: string): Promise<Success | null> {
  const [row] = await db.select({ id: invitees.id }).from(invitees).where(eq(invitees.clientRequestId, clientRequestId)).limit(1);
  return row ? resultForInvitee(db, row.id) : null;
}

/** BK-28: true when any of the hosts blocked this email or its domain. */
export async function isBlockedInvitee(db: DbOrTx, hostIds: string[], email: string): Promise<boolean> {
  if (hostIds.length === 0) return false;
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split("@")[1] ?? "";
  const rows = await db
    .select({ id: blockedInvitees.id })
    .from(blockedInvitees)
    .where(
      and(
        inArray(blockedInvitees.userId, hostIds),
        or(eq(blockedInvitees.emailNormalized, normalized), domain ? eq(blockedInvitees.domain, domain) : undefined),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** A realistic delay before the generic answer to a blocked invitee (no disclosure of the block, BK-28). */
async function blockedDelay(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  await new Promise((r) => setTimeout(r, 600 + Math.floor(Math.random() * 900)));
}

/** Effective notification mode (CAL-12): calendar invitations need a Google or Microsoft destination. */
async function notificationModeFor(
  et: BookingTarget["eventType"],
  organizerId: string,
  isPoll: boolean,
): Promise<MeetingSettingsSnapshot["notificationMode"]> {
  if (isPoll || et.kind === "group" || et.notificationType === "email_confirmation") return "email_confirmation";
  try {
    const dest = await getDestinationCalendar(organizerId, et.id);
    if (dest && (dest.provider === "google" || dest.provider === "microsoft") && dest.supports.invitations) {
      return "calendar_invitation";
    }
  } catch (e) {
    log.warn("booking.destination_lookup_failed", { error: e });
  }
  return "email_confirmation";
}

function snapshotOf(et: BookingTarget["eventType"], notificationMode: MeetingSettingsSnapshot["notificationMode"]): MeetingSettingsSnapshot {
  return {
    notificationMode,
    includeCancelRescheduleLinks: et.includeCancelRescheduleLinks,
    includeAnswersInNotifications: et.includeAnswersInNotifications,
    templates: et.notificationTemplates,
    cancellationPolicy: et.cancellationPolicy,
    locale: et.locale,
    timeZoneDisplay: et.timeZoneDisplay,
    lockedTimeZone: et.lockedTimeZone,
    color: et.color,
    afterBooking: et.afterBooking,
    redirectUrl: et.redirectUrl,
    redirectPassDetails: et.redirectPassDetails,
    scheduleAnotherEnabled: et.scheduleAnotherEnabled,
    scheduleAnotherLabel: et.scheduleAnotherLabel,
    confirmationLinks: et.confirmationLinks,
    changeCutoffMinutes: et.changeCutoffMinutes,
    requireCancelReason: et.requireCancelReason,
  };
}

function sourceOf(input: CreateBookingInput, target: BookingTarget, actor: Actor): (typeof scheduledEvents.$inferSelect)["source"] {
  if (input.pollContext) return "poll";
  if (target.kind === "one_off") return "one_off";
  if (target.kind === "single_use") return "single_use_link";
  if (actor.type === "host") return "host";
  if (actor.type === "api") return "api";
  if (input.routingFormSubmissionId) return "routing_form";
  return "booking_page";
}

function domainActor(actor: Actor, inviteeName: string, pollUserId?: string): DomainActor {
  if (pollUserId) return { type: "user", userId: pollUserId };
  if (actor.type === "host") return { type: "user", userId: actor.userId };
  if (actor.type === "api") return { type: "api", userId: actor.userId };
  return { type: "invitee", name: inviteeName };
}

// ---------------------------------------------------------------------------------------------------------------
// The plan of one booking (shared by createBooking and completeReservation)

type Plan = {
  target: BookingTarget;
  input: CreateBookingInput;
  v: ValidatedBooking;
  actor: Actor;
  at: Date;
  mode: AvailabilityMode;
  external: ExternalBusyByUser;
  notificationMode: MeetingSettingsSnapshot["notificationMode"];
  hostIds: string[];
  /** Completing a reservation. */
  reservation?: { id: string; assignment: (typeof bookingReservations.$inferSelect)["assignment"]; verifiedEmail: boolean };
};

type Recheck = { slot: Slot; prepared: PreparedAvailability; hostIds: string[]; organizerId: string; byPool: Record<string, { userId: string; reason: string }> };

function modeFor(input: CreateBookingInput, actor: Actor, start: Date, durationMinutes: number): AvailabilityMode {
  const s = start.getTime();
  const e = s + durationMinutes * MIN;
  if (input.pollContext) return { type: "poll", start: s, end: e };
  if (actor.type === "host" && actor.overrideAvailability) return { type: "override", start: s, end: e, hostUserId: actor.userId };
  return { type: "standard" };
}

async function recheckInTx(
  tx: DbOrTx,
  plan: Plan,
  opts: { ignoreInviteeId?: string; preferHostIds?: string[]; ignoreReservationId?: string },
): Promise<Recheck | Failure> {
  const start = plan.v.start;
  const duration = plan.v.durationMinutes;
  const avail = await computeAvailability(
    {
      target: plan.target,
      start,
      end: new Date(start.getTime() + MIN),
      durationMinutes: duration,
      now: plan.at,
      ignoreInviteeId: opts.ignoreInviteeId,
      ignoreReservationId: opts.ignoreReservationId,
      reservationEmail: plan.v.emailNormalized,
      ignoreLimits: plan.mode.type !== "standard",
      freshness: "submit",
    },
    {
      db: tx,
      mode: plan.mode,
      externalBusy: plan.external,
      allowAnyDuration: Boolean(plan.input.pollContext) || (plan.actor.type === "host" && Boolean(plan.actor.customize?.durationMinutes)),
    },
  );
  const end = start.getTime() + duration * MIN;
  const slot = avail.slots.find((s) => s.start === start.getTime() && s.end === end);
  if (!slot || !avail.prepared) return slotTaken();
  const prepared = avail.prepared;
  const pooled = prepared.rules.pooling !== null && prepared.rules.pools.length > 0;
  if (!pooled) {
    const required = prepared.hosts.filter((h) => h.poolId === null).map((h) => h.userId);
    const organizerRule = prepared.rules.organizerUserId;
    const organizerId = organizerRule && required.includes(organizerRule) ? organizerRule : required[0];
    if (!organizerId) return slotTaken();
    return { slot, prepared, hostIds: required, organizerId, byPool: {} };
  }
  let assignment = opts.preferHostIds?.length
    ? selectHosts({ rules: prepared.rules, hosts: prepared.hosts, slot, preferHostIds: opts.preferHostIds })
    : null;
  if (!assignment) assignment = selectHosts({ rules: prepared.rules, hosts: prepared.hosts, slot });
  if (!assignment) return slotTaken();
  return { slot, prepared, hostIds: assignment.hostIds, organizerId: assignment.organizerId, byPool: assignment.byPool };
}

/** Lock order step 2 for a group slot: the existing slot row FOR UPDATE, and the one-seat-per-email rule. */
async function lockGroupSlotInTx(tx: DbOrTx, meetingId: string, emailNormalized: string): Promise<Failure | null> {
  const [row] = await tx
    .select({ id: scheduledEvents.id, status: scheduledEvents.status })
    .from(scheduledEvents)
    .where(eq(scheduledEvents.id, meetingId))
    .limit(1)
    .for("update");
  if (!row || row.status !== "active") return slotTaken();
  const [seat] = await tx
    .select({ id: invitees.id })
    .from(invitees)
    .where(and(eq(invitees.scheduledEventId, meetingId), eq(invitees.status, "active"), eq(invitees.emailNormalized, emailNormalized)))
    .limit(1);
  return seat ? fail("already_booked", MESSAGES.alreadyBooked) : null;
}

type InsertOutcome = { inviteeIds: string[]; scheduledEventId: string; eventType: "booking.created" | "booking.rescheduled" };

/** Step 5 of the transaction: rows, reschedule cancel and link, poll booking, domain events. */
async function insertBookingInTx(tx: DbOrTx, plan: Plan, check: Recheck, old: InviteeRow | null): Promise<InsertOutcome> {
  const { target, v, input, actor, at } = plan;
  const et = target.eventType;
  const isGroup = et.kind === "group";
  const isPoll = Boolean(input.pollContext);
  const zeroBuffers = isPoll || target.kind === "one_off";
  const bufferBefore = zeroBuffers ? 0 : et.bufferBeforeMinutes;
  const bufferAfter = zeroBuffers ? 0 : et.bufferAfterMinutes;
  const start = new Date(check.slot.start);
  const end = new Date(check.slot.end);
  const bufferedStart = new Date(start.getTime() - bufferBefore * MIN);
  const bufferedEnd = new Date(end.getTime() + bufferAfter * MIN);
  const customize = actor.type === "host" ? actor.customize : undefined;

  // The old meeting (reschedule continuity, CR-04).
  const [oldEvent] = old
    ? await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, old.scheduledEventId)).limit(1)
    : [];
  const oldHosts = old
    ? await tx.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, old.scheduledEventId))
    : [];

  // Location: the invitee's choice; a same-organizer reschedule with the same option keeps the conference (VID-14).
  const config: LocationConfig | null = customize?.location ?? v.location.config;
  let location: ResolvedLocation = resolveLocation(config, v.location.value);
  const sameOrganizer = Boolean(oldEvent && oldEvent.organizerUserId === check.organizerId && !oldEvent.isGroup && !isGroup);
  const conferencing = location.status === "processing";
  if (oldEvent && sameOrganizer && conferencing && oldEvent.location.kind === location.kind && oldEvent.location.configId === location.configId) {
    location = oldEvent.location;
  }

  // Group: join the existing slot or create it (sched_group_slot_uq guards concurrent first bookings).
  const joinMeetingId = isGroup ? (check.slot.existingMeetingId ?? null) : null;
  if (joinMeetingId) {
    const blocked = await lockGroupSlotInTx(tx, joinMeetingId, v.emailNormalized);
    if (blocked) throw new BookingAbort(blocked);
  }
  const scheduledEventId = joinMeetingId ?? newId();

  // Lock order step 2: the single-use link or one-off row (throws LinkUsedError when already used).
  if ((target.kind === "single_use" || target.kind === "one_off") && target.linkId) {
    await consumeLinkInTx(tx, { kind: target.kind, id: target.linkId, scheduledEventId });
  }

  const source = sourceOf(input, target, actor);
  if (!joinMeetingId) {
    const snapshot = snapshotOf(et, sameOrganizer && oldEvent ? oldEvent.settingsSnapshot.notificationMode : plan.notificationMode);
    await tx.insert(scheduledEvents).values({
      id: scheduledEventId,
      organizationId: et.organizationId,
      eventTypeId: et.id,
      name: customize?.name?.trim() || target.overrides?.name || et.name,
      status: "active",
      startAt: start,
      endAt: end,
      durationMinutes: v.durationMinutes,
      bufferBeforeMinutes: bufferBefore,
      bufferAfterMinutes: bufferAfter,
      isGroup,
      inviteesLimit: isGroup ? Math.max(1, et.maxInvitees) : Math.max(1, input.pollContext?.participants.length ?? 1),
      location,
      organizerUserId: check.organizerId,
      source,
      singleUseLinkId: target.kind === "single_use" ? (target.linkId ?? null) : null,
      oneOffMeetingId: target.kind === "one_off" ? (target.linkId ?? null) : null,
      pollId: input.pollContext?.pollId ?? null,
      settingsSnapshot: snapshot,
      icsUid: oldEvent && !isGroup && !oldEvent.isGroup ? oldEvent.icsUid : icsUid(scheduledEventId, appHost()),
      icsSequence: oldEvent && !isGroup && !oldEvent.isGroup ? oldEvent.icsSequence + 1 : 0,
      providerIcalUid: sameOrganizer && oldEvent ? oldEvent.providerIcalUid : null,
      invitationUrl: sameOrganizer && oldEvent ? oldEvent.invitationUrl : null,
      rescheduledFromEventId: oldEvent && !oldEvent.isGroup ? oldEvent.id : null,
      provisionStatus: "pending",
      locale: v.locale,
    });
    const assigned = new Map(Object.entries(check.byPool).map(([poolId, a]) => [a.userId, { poolId, reason: a.reason }]));
    await tx.insert(scheduledEventHosts).values(
      check.hostIds.map((userId) => {
        const pool = assigned.get(userId);
        const previous = oldHosts.find((h) => h.userId === userId);
        return {
          scheduledEventId,
          userId,
          eventTypeId: et.id,
          poolId: pool?.poolId ?? null,
          role: pool ? ("assigned" as const) : userId === check.organizerId ? ("organizer" as const) : ("cohost" as const),
          isActive: true,
          startAt: start,
          endAt: end,
          bufferedStartAt: bufferedStart,
          bufferedEndAt: bufferedEnd,
          assignmentReason: pool ? (previous && old ? "same_host" : pool.reason) : null,
          // SCH-16: least recently assigned uses the assignment time, carried over unchanged by a reschedule.
          assignedAt: previous?.assignedAt ?? at,
        };
      }),
    );
  }

  // Invitees: one per poll participant, else the booker.
  const people = input.pollContext?.participants.length
    ? input.pollContext.participants.map((p) => ({
        name: p.name.trim().slice(0, 255) || p.email,
        email: p.email.trim(),
        timezone: p.timezone && p.timezone.length <= 64 ? p.timezone : v.timezone,
        participantId: p.participantId,
      }))
    : [{ name: v.name, email: v.email, timezone: v.timezone, participantId: null as string | null }];
  const inviteeIds: string[] = [];
  const schedulingMethod = actor.type === "host" ? ("instant_book" as const) : actor.type === "api" ? ("api" as const) : null;
  const scheduledBy = actor.type === "host" || actor.type === "api" ? actor.userId : (input.pollContext?.bookedByUserId ?? null);
  const routingSubmission = await validRoutingSubmission(tx, input.routingFormSubmissionId ?? null, et.organizationId);
  for (const [i, p] of people.entries()) {
    const main = i === 0;
    const id = newId();
    inviteeIds.push(id);
    await tx.insert(invitees).values({
      id,
      scheduledEventId,
      eventTypeId: et.id,
      organizationId: et.organizationId,
      email: p.email,
      emailNormalized: p.email.toLowerCase(),
      name: p.name,
      firstName: main && !input.pollContext ? v.firstName : null,
      lastName: main && !input.pollContext ? v.lastName : null,
      timezone: p.timezone,
      detectedTimezone: main && !input.pollContext ? v.detectedTimezone : null,
      timeFormat: main && !input.pollContext ? v.timeFormat : null,
      locale: v.locale,
      status: "active",
      questionsAndAnswers: main ? v.answers : [],
      locationAnswer: v.location.config ? { configId: v.location.config.id, value: v.location.value } : null,
      textReminderNumber: main ? v.textReminderNumber : null,
      marketingConsent: main ? v.marketingConsent : false,
      utmSource: v.tracking.utmSource ?? null,
      utmMedium: v.tracking.utmMedium ?? null,
      utmCampaign: v.tracking.utmCampaign ?? null,
      utmContent: v.tracking.utmContent ?? null,
      utmTerm: v.tracking.utmTerm ?? null,
      salesforceUuid: v.tracking.salesforceUuid ?? null,
      oldInviteeId: main && old ? old.id : null,
      routingFormSubmissionId: main ? routingSubmission : null,
      pollParticipantId: p.participantId && isUuid(p.participantId) ? p.participantId : null,
      schedulingMethod,
      scheduledByUserId: scheduledBy,
      emailVerifiedAt: main && plan.reservation?.verifiedEmail ? at : null,
      clientRequestId: main ? (input.clientRequestId ?? null) : null,
      reservationId: main ? (plan.reservation?.id ?? null) : null,
    });
    if (main && v.guests.length > 0) {
      await tx.insert(inviteeGuests).values(
        v.guests.map((g) => ({ inviteeId: id, scheduledEventId, email: g.email, emailNormalized: g.emailNormalized })),
      );
    }
    await tx.insert(meetingActivity).values({
      scheduledEventId,
      inviteeId: id,
      type: old && main ? "rescheduled_from" : joinMeetingId ? "invitee_added" : "booked",
      actorType: actor.type === "host" ? "user" : actor.type === "api" ? "api" : input.pollContext ? "user" : "invitee",
      actorUserId: scheduledBy,
      data: old && main ? { fromInviteeId: old.id, fromScheduledEventId: old.scheduledEventId } : { source },
    });
  }
  const mainId = inviteeIds[0]!;

  if (routingSubmission) {
    await tx.update(routingFormSubmissions).set({ inviteeId: mainId }).where(eq(routingFormSubmissions.id, routingSubmission));
  }

  // Reschedule: cancel and link the old invitee, and its meeting when no active invitee remains (CR-04).
  if (old && oldEvent) {
    const cancelerType = actor.type === "invitee" ? ("invitee" as const) : actor.type === "host" ? ("host" as const) : ("system" as const);
    const reason = input.reschedule?.reason?.trim().slice(0, 2000) || null;
    await tx
      .update(invitees)
      .set({
        status: "canceled",
        rescheduled: true,
        newInviteeId: mainId,
        canceledAt: at,
        cancelReason: reason,
        rescheduleReason: reason,
        cancelerType,
        canceledByUserId: actor.type === "host" || actor.type === "api" ? actor.userId : null,
        canceledByName: actor.type === "invitee" ? old.name : null,
      })
      .where(eq(invitees.id, old.id));
    const [stillActive] = await tx
      .select({ id: invitees.id })
      .from(invitees)
      .where(and(eq(invitees.scheduledEventId, oldEvent.id), eq(invitees.status, "active")))
      .limit(1);
    if (!stillActive) {
      await tx
        .update(scheduledEvents)
        .set({ status: "canceled", canceledAt: at, cancelReason: reason, cancelerType })
        .where(eq(scheduledEvents.id, oldEvent.id));
      await tx.update(scheduledEventHosts).set({ isActive: false }).where(eq(scheduledEventHosts.scheduledEventId, oldEvent.id));
    }
    await tx.insert(meetingActivity).values({
      scheduledEventId: oldEvent.id,
      inviteeId: old.id,
      type: "rescheduled_to",
      actorType: cancelerType === "invitee" ? "invitee" : cancelerType === "host" ? "user" : "system",
      actorUserId: actor.type === "host" || actor.type === "api" ? actor.userId : null,
      data: { toInviteeId: mainId, toScheduledEventId: scheduledEventId, reason },
    });
  }

  // Lock order step 2 for polls: the poll row after the host locks (re-validates and marks it booked).
  if (input.pollContext) {
    await markPollBookedInTx(tx, {
      pollId: input.pollContext.pollId,
      optionId: input.pollContext.optionId,
      scheduledEventId,
      inviteeIds,
      bookedByUserId: input.pollContext.bookedByUserId,
    });
  }

  if (plan.reservation) {
    await tx
      .update(bookingReservations)
      .set({ completedInviteeId: mainId, updatedAt: at })
      .where(eq(bookingReservations.id, plan.reservation.id));
  }

  const meta = { organizationId: et.organizationId, actor: domainActor(actor, v.name, input.pollContext?.bookedByUserId) };
  if (old && oldEvent) {
    const payload: DomainEventMap["booking.rescheduled"] = {
      oldInviteeId: old.id,
      newInviteeId: mainId,
      oldScheduledEventId: oldEvent.id,
      newScheduledEventId: scheduledEventId,
      reason: input.reschedule?.reason?.trim() || null,
    };
    await publishEvent(tx, "booking.rescheduled", payload, meta);
    return { inviteeIds, scheduledEventId, eventType: "booking.rescheduled" };
  }
  for (const inviteeId of inviteeIds) {
    await publishEvent(tx, "booking.created", { scheduledEventId, inviteeId, source }, meta);
  }
  return { inviteeIds, scheduledEventId, eventType: "booking.created" };
}

/** The routing submission id when it exists in the same organization and is not linked yet (cross-tenant, GEN-08). */
async function validRoutingSubmission(tx: DbOrTx, id: string | null, organizationId: string): Promise<string | null> {
  if (!id || !isUuid(id)) return null;
  const [row] = await tx
    .select({ id: routingFormSubmissions.id, inviteeId: routingFormSubmissions.inviteeId, orgId: routingForms.organizationId })
    .from(routingFormSubmissions)
    .innerJoin(routingForms, eq(routingForms.id, routingFormSubmissions.formId))
    .where(eq(routingFormSubmissions.id, id))
    .limit(1);
  return row && row.orgId === organizationId && !row.inviteeId ? row.id : null;
}

function mapTxError(e: unknown): Failure | null {
  if (e instanceof BookingAbort) return e.result;
  if (e instanceof LinkUsedError || (e as { code?: unknown } | null)?.code === "link_used") return fail("link_used", MESSAGES.linkUsed);
  if (isUniqueViolation(e, "invitees_old_invitee_uq")) return fail("slot_unavailable", MESSAGES.notReschedulable);
  if (isAppError(e) && e.code === "conflict") return fail("slot_unavailable", e.message);
  return null;
}

/** Runs the booking transaction (with the group slot retry) for a plan. */
async function runBookingTransaction(plan: Plan, preferHostIds?: string[]): Promise<CreateBookingResult> {
  const db = await getDb();
  const input = plan.input;
  for (let attempt = 0; ; attempt++) {
    try {
      const outcome = await db.transaction(
        async (tx) => {
          await lockHostsInTx(tx, plan.hostIds);
          // Idempotency inside the lock (BK-19): a double click whose first request is still in flight waits here.
          if (input.clientRequestId) {
            const existing = await findByClientRequestId(tx, input.clientRequestId);
            if (existing) return { existing };
          }
          let old: InviteeRow | null = null;
          if (input.reschedule) {
            try {
              old = await lockInviteeForChangeInTx(tx, input.reschedule.inviteeId);
            } catch (e) {
              if (isAppError(e) && (e.code === "conflict" || e.code === "not_found")) {
                throw new BookingAbort(fail("slot_unavailable", MESSAGES.notReschedulable));
              }
              throw e;
            }
            if (old.eventTypeId !== plan.target.eventType.id) throw new BookingAbort(fail("validation", MESSAGES.notReschedulable));
          }
          let prefer = preferHostIds;
          if (old && plan.target.eventType.reschedulePreference === "same_hosts" && plan.target.eventType.poolingType) {
            prefer = (await tx.select({ userId: scheduledEventHosts.userId }).from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, old.scheduledEventId))).map((h) => h.userId);
          }
          const check = await recheckInTx(tx, plan, { ignoreInviteeId: old?.id, preferHostIds: prefer });
          if ("ok" in check) throw new BookingAbort(check);
          const inserted = await insertBookingInTx(tx, plan, check, old);
          return { inserted };
        },
        { isolationLevel: "read committed" },
      );
      if ("existing" in outcome && outcome.existing) return outcome.existing;
      const inserted = (outcome as { inserted: InsertOutcome }).inserted;
      runJobsAfterResponse({ types: [eventJobPattern(inserted.eventType)] });
      return (await resultForInvitee(db, inserted.inviteeIds[0]!)) ?? {
        ok: true,
        inviteeId: inserted.inviteeIds[0]!,
        scheduledEventId: inserted.scheduledEventId,
      };
    } catch (e) {
      const mapped = mapTxError(e);
      if (mapped) return mapped;
      if (input.clientRequestId && isUniqueViolation(e, "invitees_client_request_uq")) {
        const existing = await findByClientRequestId(db, input.clientRequestId);
        if (existing) return existing;
      }
      if (isUniqueViolation(e, "sched_group_slot_uq") && attempt === 0) continue; // retry once as a join
      if (isUniqueViolation(e, "sched_group_slot_uq")) return slotTaken();
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Public entry points

type Prepared = { target: BookingTarget; v: ValidatedBooking; actor: Actor; at: Date } | Failure;

async function prepare(input: CreateBookingInput, ctx: BookingContext): Promise<Prepared> {
  const at = ctx.now ?? clockNow();
  const actor: Actor = input.actor ?? { type: "invitee" };
  const target = await resolveRequestTarget(input.target);
  if (!target) return fail("not_found", MESSAGES.notFound);
  const et = target.eventType;
  if (et.deletedAt) return fail("not_found", MESSAGES.notFound);
  if (target.linkStatus && target.linkStatus !== "active") return fail("link_used", target.linkStatus === "used" ? MESSAGES.linkUsed : "This link has expired.");
  if (!input.pollContext) {
    // Adhoc types (one-off meetings, polls) are only bookable through their own flow.
    if (et.type === "adhoc" && target.kind !== "one_off") return fail("not_found", MESSAGES.notFound);
    if (!et.active && actor.type === "invitee") return fail("not_found", MESSAGES.notAvailable);
  }
  const v = validateBookingInput(input, target, { hostActor: actor.type !== "invitee" || Boolean(input.pollContext) });
  if (!v.ok) return fail("validation", "Check the highlighted fields and try again.", { fieldErrors: v.fieldErrors });
  const value = v.value;
  if (actor.type === "host" && actor.customize?.durationMinutes) {
    const d = actor.customize.durationMinutes;
    if (!Number.isInteger(d) || d < 1 || d > 720) return fail("validation", MESSAGES.duration, { fieldErrors: { duration: [MESSAGES.duration] } });
    value.durationMinutes = d;
  }
  if (input.pollContext && input.durationMinutes) value.durationMinutes = input.durationMinutes;
  return { target, v: value, actor, at };
}

async function makePlan(
  input: CreateBookingInput,
  p: Exclude<Prepared, Failure>,
  reservation?: Plan["reservation"],
): Promise<Plan> {
  const { target, v, actor, at } = p;
  const et = target.eventType;
  const hostIds = candidateHostIds(et);
  const mode = modeFor(input, actor, v.start, v.durationMinutes);
  const external =
    mode.type === "poll"
      ? {}
      : await prefetchExternalBusy(target, v.start, new Date(v.start.getTime() + v.durationMinutes * MIN), "submit");
  const organizerGuess = et.organizerUserId ?? et.ownerUserId ?? hostIds[0] ?? "";
  const notificationMode = await notificationModeFor(et, organizerGuess, Boolean(input.pollContext));
  return { target, input, v, actor, at, mode, external, notificationMode, hostIds, reservation };
}

function needsVerification(input: CreateBookingInput, target: BookingTarget, actor: Actor): boolean {
  return target.eventType.requireEmailVerification && !input.reschedule && !input.pollContext && actor.type === "invitee";
}

function needsPayment(input: CreateBookingInput, target: BookingTarget, actor: Actor): boolean {
  return (
    target.eventType.paymentEnabled &&
    (target.eventType.priceMinor ?? 0) > 0 &&
    isPaymentsConfigured() &&
    !input.reschedule &&
    !input.pollContext &&
    actor.type === "invitee"
  );
}

/**
 * Books a slot (ARCHITECTURE section 9). Invitee bookings of event types with email verification answer
 * verification_required with a reservation id (the code email is queued), paid ones payment_required.
 */
export async function createBooking(input: CreateBookingInput, ctx: BookingContext): Promise<CreateBookingResult> {
  const p = await prepare(input, ctx);
  if ("ok" in p) return p;
  const db = await getDb();

  // Fast path of the idempotency check (repeated inside the locked transaction).
  if (input.clientRequestId) {
    const existing = await findByClientRequestId(db, input.clientRequestId);
    if (existing) return existing;
  }

  // BK-28: blocked emails get the generic answer after a realistic delay (hosts and the API see "blocked").
  if (await isBlockedInvitee(db, candidateHostIds(p.target.eventType), p.v.email)) {
    if (p.actor.type !== "invitee") return fail("blocked", "This invitee is blocked.");
    await blockedDelay();
    return slotTaken();
  }

  if (needsVerification(input, p.target, p.actor)) {
    if (input.verification) {
      const r = await verifyReservationCode(input.verification.reservationId, input.verification.code, { now: p.at });
      if (r.ok) return { ok: true, inviteeId: r.inviteeId, scheduledEventId: r.scheduledEventId, ...(r.redirectUrl ? { redirectUrl: r.redirectUrl } : {}) };
      if (r.code === "invalid_code" || r.code === "expired" || r.code === "too_many_attempts") {
        return fail("verification_required", r.message, { reservationId: input.verification.reservationId });
      }
      return fail(r.code === "not_found" ? "not_found" : r.code, r.message);
    }
    const trusted = await isTrustedDevice(db, ctx.trustedDeviceTokens, p.v.email, p.at);
    if (!trusted) {
      const r = await reserve(input, p, "email_verification");
      if (!r.ok) return r;
      if (!r.reused) {
        await issueVerificationCode(db, { reservationId: r.reservationId, email: p.v.email, at: p.at });
        runJobsAfterResponse({ types: [SEND_CODE_JOB] });
      }
      return fail("verification_required", verificationPrompt(p.v.email), { reservationId: r.reservationId });
    }
  }
  if (needsPayment(input, p.target, p.actor)) {
    const r = await reserve(input, p, "payment");
    if (!r.ok) return r;
    return fail("payment_required", "Payment is required to complete this booking.", { reservationId: r.reservationId });
  }

  const plan = await makePlan(input, p);
  return runBookingTransaction(plan);
}

/** Inserts a hold under the booking locks (SCH-19): exactly the meeting's hosts, or one seat of a group slot. */
async function reserve(
  input: CreateBookingInput,
  p: Exclude<Prepared, Failure>,
  kind: "payment" | "email_verification",
): Promise<{ ok: true; reservationId: string; expiresAt: Date; reused: boolean } | Failure> {
  const plan = await makePlan(input, p);
  const db = await getDb();
  const et = plan.target.eventType;
  try {
    return await db.transaction(
      async (tx) => {
        await lockHostsInTx(tx, plan.hostIds);
        // The same email retrying the same slot (double click, payment retry) keeps its live hold (SCH-19).
        const [live] = await tx
          .select({ id: bookingReservations.id, expiresAt: bookingReservations.expiresAt })
          .from(bookingReservations)
          .where(
            and(
              eq(bookingReservations.eventTypeId, et.id),
              eq(bookingReservations.kind, kind),
              eq(bookingReservations.inviteeEmailNormalized, plan.v.emailNormalized),
              eq(bookingReservations.startAt, plan.v.start),
              eq(bookingReservations.status, "pending"),
              gt(bookingReservations.expiresAt, new Date(plan.at.getTime() + MIN)),
            ),
          )
          .limit(1);
        if (live) return { ok: true as const, reservationId: live.id, expiresAt: live.expiresAt, reused: true };
        const check = await recheckInTx(tx, plan, {});
        if ("ok" in check) throw new BookingAbort(check);
        if (et.kind === "group" && check.slot.existingMeetingId) {
          const blocked = await lockGroupSlotInTx(tx, check.slot.existingMeetingId, plan.v.emailNormalized);
          if (blocked) throw new BookingAbort(blocked);
        }
        // Older holds of this email for the slot (expiring, or of the other kind) are replaced.
        await tx
          .update(bookingReservations)
          .set({ status: "canceled", updatedAt: plan.at })
          .where(
            and(
              eq(bookingReservations.eventTypeId, et.id),
              eq(bookingReservations.inviteeEmailNormalized, plan.v.emailNormalized),
              eq(bookingReservations.startAt, plan.v.start),
              eq(bookingReservations.status, "pending"),
            ),
          );
        const start = new Date(check.slot.start);
        const end = new Date(check.slot.end);
        const zero = plan.target.kind === "one_off";
        const expiresAt = new Date(plan.at.getTime() + RESERVATION_HOLD_MS);
        const assignment = Object.keys(check.byPool).length > 0 ? { organizerId: check.organizerId, byPool: check.byPool } : null;
        const payload: CreateBookingInput = { ...input, verification: null, clientRequestId: input.clientRequestId, actor: { type: "invitee" } };
        const [row] = await tx
          .insert(bookingReservations)
          .values({
            kind,
            status: "pending",
            eventTypeId: et.id,
            targetKind: plan.target.kind,
            targetId: plan.target.linkId ?? et.id,
            startAt: start,
            endAt: end,
            bufferedStartAt: new Date(start.getTime() - (zero ? 0 : et.bufferBeforeMinutes) * MIN),
            bufferedEndAt: new Date(end.getTime() + (zero ? 0 : et.bufferAfterMinutes) * MIN),
            hostUserIds: check.hostIds,
            assignment,
            isGroupSeat: et.kind === "group",
            inviteeEmailNormalized: plan.v.emailNormalized,
            payload: payload as unknown as Record<string, unknown>,
            expiresAt,
          })
          .returning({ id: bookingReservations.id });
        if (!row) throw new Error("reserve: insert returned no row");
        await enqueueJob(tx, {
          type: "booking.reservation_expire",
          payload: { reservationId: row.id },
          runAt: new Date(expiresAt.getTime() + MIN),
          idempotencyKey: `reservation-expire:${row.id}`,
        });
        return { ok: true as const, reservationId: row.id, expiresAt, reused: false };
      },
      { isolationLevel: "read committed" },
    );
  } catch (e) {
    const mapped = mapTxError(e);
    if (mapped) return mapped;
    throw e;
  }
}

/** A hold instead of a meeting (payment or email verification), under the same locks and recheck as a booking. */
export async function createReservation(
  input: CreateBookingInput & { kind: "payment" | "email_verification" },
  ctx: BookingContext,
): Promise<{ ok: true; reservationId: string; expiresAt: Date } | Extract<CreateBookingResult, { ok: false }>> {
  const { kind, ...rest } = input;
  const p = await prepare(rest, ctx);
  if ("ok" in p) return p;
  const db = await getDb();
  if (await isBlockedInvitee(db, candidateHostIds(p.target.eventType), p.v.email)) {
    if (p.actor.type !== "invitee") return fail("blocked", "This invitee is blocked.");
    await blockedDelay();
    return slotTaken();
  }
  const r = await reserve(rest, p, kind);
  if (!r.ok) return r;
  if (kind === "email_verification" && !r.reused) {
    await issueVerificationCode(db, { reservationId: r.reservationId, email: p.v.email, at: p.at });
    runJobsAfterResponse({ types: [SEND_CODE_JOB] });
  }
  return { ok: true, reservationId: r.reservationId, expiresAt: r.expiresAt };
}

/**
 * Completes a reservation at most once (ARCHITECTURE section 9): conditional status update under the host locks,
 * recheck ignoring the hold itself, then the meeting rows with invitees.reservation_id = id (unique). A slot that is
 * no longer free cancels the hold (and queues the refund of a payment).
 */
export async function completeReservation(
  reservationId: string,
  extra: { paymentId?: string; verifiedEmail?: boolean; now?: Date },
): Promise<CreateBookingResult> {
  if (!isUuid(reservationId)) return fail("not_found", "This booking could not be found.");
  const db = await getDb();
  const [res] = await db.select().from(bookingReservations).where(eq(bookingReservations.id, reservationId)).limit(1);
  if (!res) return fail("not_found", "This booking could not be found.");
  const done = async () => {
    const [inv] = await db.select({ id: invitees.id }).from(invitees).where(eq(invitees.reservationId, reservationId)).limit(1);
    return inv ? resultForInvitee(db, inv.id) : null;
  };
  if (res.status === "completed" || res.status === "canceled") {
    return (await done()) ?? (res.status === "canceled" ? slotTaken() : fail("not_found", "This booking could not be found."));
  }
  // An email verification hold completes only once the code was checked (verifyReservationCode).
  if (res.kind === "email_verification" && extra.verifiedEmail !== true) {
    return fail("verification_required", verificationPrompt(res.inviteeEmailNormalized), { reservationId });
  }
  const at = extra.now ?? clockNow();
  const input = res.payload as unknown as CreateBookingInput;
  const p = await prepare({ ...input, actor: { type: "invitee" } }, { now: at });
  if ("ok" in p) {
    // The event type changed since the hold (deleted, turned off, new required question): cancel it, refund payments.
    await db.transaction(async (tx) => {
      const canceled = await tx
        .update(bookingReservations)
        .set({ status: "canceled", updatedAt: at })
        .where(and(eq(bookingReservations.id, reservationId), or(eq(bookingReservations.status, "pending"), eq(bookingReservations.status, "expired"))))
        .returning({ id: bookingReservations.id });
      if (canceled.length > 0 && res.kind === "payment") {
        await enqueueJob(tx, {
          type: "payments.refund",
          payload: { reservationId, paymentId: extra.paymentId ?? null, reason: "event_type_changed" },
          idempotencyKey: `refund:${reservationId}`,
        });
      }
    });
    return p.code === "validation" ? slotTaken() : p;
  }
  const plan = await makePlan(input, p, { id: res.id, assignment: res.assignment, verifiedEmail: extra.verifiedEmail === true });
  plan.hostIds = [...new Set([...plan.hostIds, ...res.hostUserIds])].sort();

  try {
    const outcome = await db.transaction(
      async (tx) => {
        await lockHostsInTx(tx, plan.hostIds);
        const claimed = await tx
          .update(bookingReservations)
          .set({ status: "completed", updatedAt: at })
          .where(
            and(
              eq(bookingReservations.id, reservationId),
              or(
                eq(bookingReservations.status, "pending"),
                and(eq(bookingReservations.kind, "payment"), eq(bookingReservations.status, "expired")),
              ),
            ),
          )
          .returning({ id: bookingReservations.id, expiresAt: bookingReservations.expiresAt, kind: bookingReservations.kind });
        if (claimed.length === 0) return { lost: true as const };
        // An email verification hold that expired no longer protects the slot.
        if (claimed[0]!.kind === "email_verification" && claimed[0]!.expiresAt.getTime() <= at.getTime()) {
          await tx.update(bookingReservations).set({ status: "expired", updatedAt: at }).where(eq(bookingReservations.id, reservationId));
          return { expired: true as const };
        }
        const prefer = res.assignment ? Object.values(res.assignment.byPool).map((a) => a.userId) : undefined;
        const check = await recheckInTx(tx, plan, { ignoreReservationId: reservationId, preferHostIds: prefer });
        if ("ok" in check) {
          await tx.update(bookingReservations).set({ status: "canceled", updatedAt: at }).where(eq(bookingReservations.id, reservationId));
          if (res.kind === "payment") {
            await enqueueJob(tx, {
              type: "payments.refund",
              payload: { reservationId, paymentId: extra.paymentId ?? null, reason: "slot_unavailable" },
              idempotencyKey: `refund:${reservationId}`,
            });
          }
          return { unavailable: check };
        }
        const inserted = await insertBookingInTx(tx, plan, check, null);
        return { inserted };
      },
      { isolationLevel: "read committed" },
    );
    if ("lost" in outcome) return (await done()) ?? fail("not_found", "This booking could not be found.");
    if ("expired" in outcome) return fail("slot_unavailable", "This verification code has expired. Please select the time again.");
    if ("unavailable" in outcome) {
      runJobsAfterResponse({ types: ["payments.refund"] });
      return outcome.unavailable as Failure;
    }
    const inserted = outcome.inserted as InsertOutcome;
    runJobsAfterResponse({ types: [eventJobPattern(inserted.eventType)] });
    return (await resultForInvitee(db, inserted.inviteeIds[0]!)) ?? {
      ok: true,
      inviteeId: inserted.inviteeIds[0]!,
      scheduledEventId: inserted.scheduledEventId,
    };
  } catch (e) {
    if (isUniqueViolation(e, "invitees_reservation_uq")) return (await done()) ?? slotTaken();
    const mapped = mapTxError(e);
    if (mapped) {
      await db.update(bookingReservations).set({ status: "canceled", updatedAt: at }).where(and(eq(bookingReservations.id, reservationId), eq(bookingReservations.status, "pending")));
      return mapped;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Email verification (BK-17) and reservation status (BK-31)

/** "To complete your booking, enter the 6-digit code sent to {email}" (BK-17). */
export function verificationPrompt(email: string): string {
  return `To complete your booking, enter the 6-digit code sent to ${email}`;
}

/**
 * Checks the 6-digit code of an email verification reservation and completes the booking (BK-17). With
 * rememberDevice, the result carries the new "Remember this device" cookie value (365 days for that email).
 */
export async function verifyReservationCode(
  reservationId: string,
  code: string,
  opts: { now?: Date; rememberDevice?: boolean; existingDeviceTokens?: string[] } = {},
): Promise<VerifyCodeResult> {
  const notFound = { ok: false as const, code: "not_found" as const, message: "This booking could not be found." };
  if (!isUuid(reservationId)) return notFound;
  const at = opts.now ?? clockNow();
  const db = await getDb();
  const [res] = await db.select().from(bookingReservations).where(eq(bookingReservations.id, reservationId)).limit(1);
  if (!res || res.kind !== "email_verification") return notFound;
  if (res.status === "completed") {
    const [inv] = await db.select({ id: invitees.id }).from(invitees).where(eq(invitees.reservationId, reservationId)).limit(1);
    const done = inv ? await resultForInvitee(db, inv.id) : null;
    return done ?? notFound;
  }
  if (res.status !== "pending" || res.expiresAt.getTime() <= at.getTime()) {
    return { ok: false, code: "expired", message: "This code has expired. Please select the time again." };
  }
  const check = await checkVerificationCode(db, { reservationId, code, at });
  if (check === "invalid") return { ok: false, code: "invalid_code", message: "That code isn't correct. Try again." };
  if (check === "too_many_attempts") {
    return { ok: false, code: "too_many_attempts", message: "Too many incorrect attempts. Request a new code." };
  }
  if (check === "expired" || check === "not_found") {
    return { ok: false, code: "expired", message: "This code has expired. Request a new code." };
  }
  const result = await completeReservation(reservationId, { verifiedEmail: true, now: at });
  if (!result.ok) {
    const failCode = result.code === "already_booked" || result.code === "link_used" ? result.code : result.code === "not_found" ? "not_found" : "slot_unavailable";
    return { ok: false, code: failCode, message: result.message };
  }
  if (!opts.rememberDevice) return result;
  const value = await rememberDevice(db, { email: res.inviteeEmailNormalized, at, existing: opts.existingDeviceTokens });
  return { ...result, trustedDevice: { cookieName: TRUSTED_DEVICE_COOKIE, value, maxAgeSeconds: TRUSTED_DEVICE_MAX_AGE_SECONDS } };
}

/** "Didn't get it? Resend code" (BK-17: at most 5 per hour); extends the hold so the new code stays usable. */
export async function resendReservationCode(reservationId: string, opts: { now?: Date } = {}): Promise<{ ok: true; email: string }> {
  if (!isUuid(reservationId)) throw new AppError("not_found", "This booking could not be found.");
  const at = opts.now ?? clockNow();
  const db = await getDb();
  const [res] = await db.select().from(bookingReservations).where(eq(bookingReservations.id, reservationId)).limit(1);
  if (!res || res.kind !== "email_verification") throw new AppError("not_found", "This booking could not be found.");
  if (res.status !== "pending" || res.expiresAt.getTime() <= at.getTime()) {
    throw new AppError("conflict", "This code has expired. Please select the time again.");
  }
  const limit = await rateLimit(`booking:code_resend:${reservationId}`, VERIFICATION_RESENDS_PER_HOUR, 3600, { nowMs: at.getTime() });
  if (!limit.ok) throw rateLimitedError(limit, "You've requested too many codes. Try again later.");
  const input = res.payload as unknown as CreateBookingInput;
  const email = typeof input?.invitee?.email === "string" ? input.invitee.email.trim() : res.inviteeEmailNormalized;
  await db.transaction(async (tx) => {
    // The new code gets a full 10 minutes; at most 5 resends per hour bound the hold.
    const extended = Math.max(res.expiresAt.getTime(), at.getTime() + RESERVATION_HOLD_MS);
    if (extended > res.expiresAt.getTime()) {
      await tx
        .update(bookingReservations)
        .set({ expiresAt: new Date(extended), updatedAt: at })
        .where(and(eq(bookingReservations.id, reservationId), eq(bookingReservations.status, "pending")));
    }
    await issueVerificationCode(tx, { reservationId, email, at });
  });
  runJobsAfterResponse({ types: [SEND_CODE_JOB] });
  return { ok: true, email };
}

/** Reservation state for the embed payment polling endpoint (BK-31); null for unknown ids. */
export async function getReservationStatus(reservationId: string): Promise<ReservationStatus | null> {
  if (!isUuid(reservationId)) return null;
  const db = await getDb();
  const [res] = await db
    .select({
      status: bookingReservations.status,
      kind: bookingReservations.kind,
      expiresAt: bookingReservations.expiresAt,
      completedInviteeId: bookingReservations.completedInviteeId,
    })
    .from(bookingReservations)
    .where(eq(bookingReservations.id, reservationId))
    .limit(1);
  if (!res) return null;
  let inviteeId = res.completedInviteeId;
  if (!inviteeId && res.status === "completed") {
    const [inv] = await db.select({ id: invitees.id }).from(invitees).where(eq(invitees.reservationId, reservationId)).limit(1);
    inviteeId = inv?.id ?? null;
  }
  return { status: res.status, kind: res.kind, inviteeId: inviteeId ?? null, expiresAt: res.expiresAt.toISOString() };
}

