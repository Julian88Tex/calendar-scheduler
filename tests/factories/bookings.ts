// Scheduled events with hosts and invitees (direct inserts, bypassing the booking service), reservations, no-shows.
import { asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import {
  bookingReservations,
  eventTypeHosts,
  inviteeGuests,
  inviteeNoShows,
  invitees,
  scheduledEventHosts,
  scheduledEvents,
} from "@/db/schema";
import type { QuestionAnswer, ResolvedLocation } from "@/db/types";
import { addMinutes, EMPTY_LOCATION, newId, normalizeEmail, one, snapshotFor, toDate, uniq } from "./_util";
import type { EventTypeRow } from "./event-types";

export type ScheduledEventRow = typeof scheduledEvents.$inferSelect;
export type ScheduledEventHostRow = typeof scheduledEventHosts.$inferSelect;
export type InviteeRow = typeof invitees.$inferSelect;

export type InviteeSpec = {
  email?: string;
  name?: string;
  timezone?: string | null;
  status?: "active" | "canceled";
  questionsAndAnswers?: QuestionAnswer[];
  guests?: string[];
  overrides?: Partial<typeof invitees.$inferInsert>;
};

export type CreateBookingOptions = {
  eventType: EventTypeRow;
  start: Date | string;
  durationMinutes?: number;
  /** Explicit hosts; default derived from event_type_hosts (solo: owner; collective: all; round robin: first). */
  hosts?: { userId: string; role?: "organizer" | "cohost" | "assigned"; poolId?: string | null }[];
  organizerUserId?: string;
  /** One invitee (default) or several (group events). Pass [] for none. */
  invitee?: InviteeSpec;
  invitees?: InviteeSpec[];
  status?: "active" | "canceled";
  source?: ScheduledEventRow["source"];
  location?: ResolvedLocation;
  overrides?: Partial<typeof scheduledEvents.$inferInsert>;
};

async function defaultHosts(db: DbOrTx, et: EventTypeRow) {
  const rows = await db
    .select()
    .from(eventTypeHosts)
    .where(eq(eventTypeHosts.eventTypeId, et.id))
    .orderBy(asc(eventTypeHosts.position));
  if (rows.length === 0) {
    if (!et.ownerUserId) throw new Error("createBooking: event type has no hosts and no owner");
    return [{ userId: et.ownerUserId, role: "organizer" as const, poolId: null }];
  }
  if (et.poolingType === "round_robin") {
    const first = rows[0];
    return [{ userId: first.userId, role: "assigned" as const, poolId: first.poolId }];
  }
  if (et.poolingType === "multi_pool") {
    const required = rows.filter((r) => r.poolId === null);
    const firstPerPool = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (r.poolId && !firstPerPool.has(r.poolId)) firstPerPool.set(r.poolId, r);
    return [
      ...required.map((r, i) => ({ userId: r.userId, role: i === 0 ? ("organizer" as const) : ("cohost" as const), poolId: null })),
      ...[...firstPerPool.values()].map((r) => ({ userId: r.userId, role: "assigned" as const, poolId: r.poolId })),
    ];
  }
  // solo personal, group, collective: every host attends, the first organizes
  return rows.map((r, i) => ({ userId: r.userId, role: i === 0 ? ("organizer" as const) : ("cohost" as const), poolId: null }));
}

export async function createBooking(db: DbOrTx, opts: CreateBookingOptions) {
  const et = opts.eventType;
  const start = toDate(opts.start);
  const duration = opts.durationMinutes ?? et.durationMinutes;
  const end = addMinutes(start, duration);
  const hostSpecs = opts.hosts ?? (await defaultHosts(db, et));
  if (hostSpecs.length === 0) throw new Error("createBooking: no hosts");
  const organizerUserId =
    opts.organizerUserId ?? hostSpecs.find((h) => h.role === "organizer")?.userId ?? hostSpecs[0].userId;
  const status = opts.status ?? "active";
  const id = newId();
  const scheduledEvent = one(
    await db
      .insert(scheduledEvents)
      .values({
        id,
        organizationId: et.organizationId,
        eventTypeId: et.id,
        name: et.name,
        status,
        startAt: start,
        endAt: end,
        durationMinutes: duration,
        bufferBeforeMinutes: et.bufferBeforeMinutes,
        bufferAfterMinutes: et.bufferAfterMinutes,
        isGroup: et.kind === "group",
        inviteesLimit: et.maxInvitees,
        location: opts.location ?? EMPTY_LOCATION,
        organizerUserId,
        source: opts.source ?? "booking_page",
        settingsSnapshot: snapshotFor(et),
        icsUid: `${id}@kairos`,
        canceledAt: status === "canceled" ? new Date() : null,
        cancelerType: status === "canceled" ? "host" : null,
        ...opts.overrides,
      })
      .returning(),
    "scheduled event",
  );
  const bufferedStart = addMinutes(start, -et.bufferBeforeMinutes);
  const bufferedEnd = addMinutes(end, et.bufferAfterMinutes);
  const hosts = await db
    .insert(scheduledEventHosts)
    .values(
      hostSpecs.map((h) => ({
        scheduledEventId: scheduledEvent.id,
        userId: h.userId,
        eventTypeId: et.id,
        poolId: h.poolId ?? null,
        role: h.role ?? "organizer",
        isActive: status === "active",
        startAt: start,
        endAt: end,
        bufferedStartAt: bufferedStart,
        bufferedEndAt: bufferedEnd,
        assignmentReason: h.role === "assigned" ? "priority" : null,
        assignedAt: new Date(),
      })),
    )
    .returning();

  const inviteeSpecs = opts.invitees ?? [opts.invitee ?? {}];
  const createdInvitees: InviteeRow[] = [];
  for (const spec of inviteeSpecs) {
    const email = spec.email ?? `${uniq("guest")}@example.com`;
    const name = spec.name ?? "Test Invitee";
    const inviteeStatus = spec.status ?? (status === "canceled" ? "canceled" : "active");
    const invitee = one(
      await db
        .insert(invitees)
        .values({
          scheduledEventId: scheduledEvent.id,
          eventTypeId: et.id,
          organizationId: et.organizationId,
          email,
          emailNormalized: normalizeEmail(email),
          name,
          firstName: name.split(" ")[0] ?? null,
          lastName: name.split(" ").slice(1).join(" ") || null,
          timezone: spec.timezone ?? "America/New_York",
          status: inviteeStatus,
          questionsAndAnswers: spec.questionsAndAnswers ?? [],
          canceledAt: inviteeStatus === "canceled" ? new Date() : null,
          ...spec.overrides,
        })
        .returning(),
      "invitee",
    );
    if (spec.guests?.length) {
      await db.insert(inviteeGuests).values(
        spec.guests.map((g) => ({
          inviteeId: invitee.id,
          scheduledEventId: scheduledEvent.id,
          email: g,
          emailNormalized: normalizeEmail(g),
        })),
      );
    }
    createdInvitees.push(invitee);
  }

  return { scheduledEvent, hosts, invitees: createdInvitees, invitee: createdInvitees[0] ?? null };
}

export async function createReservation(
  db: DbOrTx,
  opts: {
    eventType: EventTypeRow;
    start: Date | string;
    hostUserIds: string[];
    kind?: "payment" | "email_verification";
    inviteeEmail?: string;
    expiresAt?: Date;
    status?: "pending" | "completed" | "expired" | "canceled";
  },
) {
  const start = toDate(opts.start);
  const end = addMinutes(start, opts.eventType.durationMinutes);
  return one(
    await db
      .insert(bookingReservations)
      .values({
        kind: opts.kind ?? "payment",
        status: opts.status ?? "pending",
        eventTypeId: opts.eventType.id,
        targetKind: "event_type",
        targetId: opts.eventType.id,
        startAt: start,
        endAt: end,
        bufferedStartAt: addMinutes(start, -opts.eventType.bufferBeforeMinutes),
        bufferedEndAt: addMinutes(end, opts.eventType.bufferAfterMinutes),
        hostUserIds: opts.hostUserIds,
        isGroupSeat: opts.eventType.kind === "group",
        inviteeEmailNormalized: normalizeEmail(opts.inviteeEmail ?? `${uniq("r")}@example.com`),
        payload: {},
        expiresAt: opts.expiresAt ?? addMinutes(new Date(), 10),
      })
      .returning(),
    "reservation",
  );
}

export async function markNoShow(db: DbOrTx, inviteeId: string, createdByUserId?: string) {
  return one(
    await db.insert(inviteeNoShows).values({ inviteeId, createdByUserId: createdByUserId ?? null }).returning(),
    "no-show",
  );
}
