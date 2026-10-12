// Shared by factories.test.ts (PGlite) and factories.pg.test.ts (real Postgres): one smoke insert per major table
// through the factories, then a few schema constraints that services rely on.
import { expect } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { isUniqueViolation, pgCode, pgConstraint } from "@/db/helpers";
import {
  eventTypes,
  externalEvents,
  handles,
  inviteeGuests,
  invitees,
  meetingPollVotes,
  scheduledEventHosts,
  scheduledEvents,
  users,
} from "@/db/schema";
import {
  addExternalBusy,
  createApiToken,
  createBooking,
  createCalendarConnection,
  createCalendarFeed,
  createConferencingConnection,
  createContact,
  createCoupon,
  createEventType,
  createGroup,
  createInvitation,
  createOneOffMeeting,
  createPayment,
  createPoll,
  createReservation,
  createRoutingForm,
  createSchedule,
  createSingleUseLink,
  createTeam,
  createUser,
  createWebhookSubscription,
  createWorkflow,
  markNoShow,
} from "../factories";

async function expectPgError(p: Promise<unknown>, code: string, constraint?: string) {
  let error: unknown = null;
  try {
    await p;
  } catch (e) {
    error = e;
  }
  expect(error, `expected SQLSTATE ${code}`).not.toBeNull();
  expect(pgCode(error)).toBe(code);
  if (constraint) expect(pgConstraint(error)).toBe(constraint);
}

export async function runFactorySmoke(db: DB): Promise<void> {
  const owner = await createUser(db, { name: "Owner One" });
  const member = await createUser(db, { organizationId: owner.organizationId, orgRole: "admin" });
  const other = await createUser(db);
  expect(owner.orgRole).toBe("owner");
  expect(member.orgRole).toBe("admin");

  const schedule = await createSchedule(db, { userId: owner.id, dateOverrides: [{ date: "2026-12-24", intervals: [] }] });
  expect(schedule.isDefault).toBe(true);

  const { team } = await createTeam(db, {
    organizationId: owner.organizationId,
    members: [
      { userId: owner.id, role: "manager" },
      { userId: member.id, role: "member" },
    ],
  });
  await createGroup(db, { organizationId: owner.organizationId, members: [{ userId: member.id, role: "admin" }] });
  await createInvitation(db, { organizationId: owner.organizationId, invitedByUserId: owner.id });

  const solo = await createEventType(db, {
    owner,
    questions: [{ label: "What would you like to discuss?", required: true }],
    overrides: { bufferBeforeMinutes: 15, bufferAfterMinutes: 15 },
  });
  expect(solo.hosts).toHaveLength(1);
  const rr = await createEventType(db, {
    team,
    poolingType: "round_robin",
    hosts: [{ userId: owner.id }, { userId: member.id }],
  });
  expect(rr.pools).toHaveLength(1);
  expect(rr.hosts.every((h) => h.poolId === rr.pools[0].id)).toBe(true);
  const collective = await createEventType(db, {
    team,
    poolingType: "collective",
    hosts: [{ userId: owner.id }, { userId: member.id }],
  });
  const group = await createEventType(db, { owner, kind: "group", maxInvitees: 5 });

  const booking = await createBooking(db, {
    eventType: solo.eventType,
    start: "2026-10-20T15:00:00Z",
    invitee: { guests: ["guest@example.com"] },
  });
  expect(booking.hosts[0].bufferedStartAt.toISOString()).toBe("2026-10-20T14:45:00.000Z");
  expect(booking.hosts[0].bufferedEndAt.toISOString()).toBe("2026-10-20T15:45:00.000Z");
  await markNoShow(db, booking.invitee!.id, owner.id);
  const rrBooking = await createBooking(db, { eventType: rr.eventType, start: "2026-10-21T15:00:00Z" });
  expect(rrBooking.hosts[0].role).toBe("assigned");
  const collBooking = await createBooking(db, { eventType: collective.eventType, start: "2026-10-22T15:00:00Z" });
  expect(collBooking.hosts.map((h) => h.role)).toEqual(["organizer", "cohost"]);
  const groupBooking = await createBooking(db, {
    eventType: group.eventType,
    start: "2026-10-23T15:00:00Z",
    invitees: [{}, {}, {}],
  });
  expect(groupBooking.invitees).toHaveLength(3);
  const reservation = await createReservation(db, {
    eventType: solo.eventType,
    start: "2026-10-24T15:00:00Z",
    hostUserIds: [owner.id],
  });

  const { calendars } = await createCalendarConnection(db, { userId: owner.id });
  await addExternalBusy(db, {
    calendar: calendars[0],
    events: [{ start: "2026-10-20T17:00:00Z", end: "2026-10-20T18:00:00Z" }],
    window: { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" },
  });
  await createConferencingConnection(db, { userId: owner.id });

  const poll = await createPoll(db, {
    owner,
    coHostIds: [member.id],
    participants: [{ name: "Ana", votes: { 0: "yes", 1: "no" } }],
  });
  expect(poll.options).toHaveLength(2);
  expect(poll.eventType.bookingMethod).toBe("poll");

  await createRoutingForm(db, {
    owner,
    routes: [{ destination: { type: "event_type", eventTypeId: solo.eventType.id } }],
  });
  const { contact } = await createContact(db, { owner, emails: ["Contact@Example.com"] });
  await createWorkflow(db, { owner, eventTypeIds: [solo.eventType.id] });
  await createSingleUseLink(db, { eventType: solo.eventType, overrides: { contactId: contact.id } });
  await createOneOffMeeting(db, { owner });
  await createWebhookSubscription(db, { owner });
  await createApiToken(db, { userId: owner.id });
  await createCalendarFeed(db, { userId: owner.id });
  const coupon = await createCoupon(db, { ownerUserId: owner.id, eventTypeIds: [solo.eventType.id] });
  await createPayment(db, {
    organizationId: owner.organizationId,
    inviteeId: booking.invitee!.id,
    scheduledEventId: booking.scheduledEvent.id,
    reservationId: reservation.id,
  });
  expect(coupon.codeNormalized).toBe(coupon.code.toLowerCase());

  // Relational reads across files.
  const loaded = await db.query.scheduledEvents.findFirst({
    where: (t, { eq: e }) => e(t.id, booking.scheduledEvent.id),
    with: { hosts: { with: { user: true } }, invitees: { with: { guests: true, noShow: true, payments: true } }, eventType: true },
  });
  expect(loaded?.invitees[0].guests).toHaveLength(1);
  expect(loaded?.invitees[0].noShow).not.toBeNull();
  expect(loaded?.invitees[0].payments).toHaveLength(1);
  expect(loaded?.hosts[0].user.id).toBe(owner.id);
  const withHandle = await db.query.users.findFirst({ where: (t, { eq: e }) => e(t.id, owner.id), with: { handle: true } });
  expect(withHandle?.handle?.slug).toBe(owner.slug);

  // --- constraints services rely on ---
  // users_email_uq is partial (deleted_at is null): a soft-deleted account releases its email (AU-15).
  await expectPgError(
    createUser(db, { email: owner.email.toUpperCase(), withoutHandle: true }),
    "23505",
    "users_email_uq",
  );
  await db.update(users).set({ deletedAt: new Date(), slug: null }).where(eq(users.id, other.id));
  await db.delete(handles).where(eq(handles.userId, other.id));
  await createUser(db, { email: other.email, slug: other.slug ?? undefined });

  // handles: shared namespace for users and teams.
  await expectPgError(db.insert(handles).values({ slug: team.slug, userId: member.id }), "23505");
  await expectPgError(db.insert(handles).values({ slug: "nobody-owns-this" }), "23514", "handles_one_owner");

  // event_types checks.
  await expectPgError(
    createEventType(db, { owner, overrides: { durationMinutes: 721 } }),
    "23514",
    "event_types_duration_ck",
  );
  await expectPgError(
    createEventType(db, { owner, kind: "group", overrides: { durationOptions: [30, 60] } }),
    "23514",
    "event_types_group_durations_ck",
  );
  await expectPgError(
    createEventType(db, { owner, slug: solo.eventType.slug }),
    "23505",
    "event_types_user_slug_uq",
  );

  // One active scheduled event per group slot (sched_group_slot_uq).
  let groupSlotError: unknown = null;
  try {
    await createBooking(db, { eventType: group.eventType, start: "2026-10-23T15:00:00Z" });
  } catch (e) {
    groupSlotError = e;
  }
  expect(isUniqueViolation(groupSlotError, "sched_group_slot_uq")).toBe(true);

  // Meetings keep their organizer: deleting a host with meetings is restricted.
  await expectPgError(db.delete(users).where(eq(users.id, member.id)), "23001"); // restrict_violation

  // Cascades: deleting a scheduled event removes hosts, invitees and guests.
  await db.delete(scheduledEvents).where(eq(scheduledEvents.id, booking.scheduledEvent.id));
  const leftovers = await db
    .select({ n: sql<number>`count(*)` })
    .from(invitees)
    .where(eq(invitees.scheduledEventId, booking.scheduledEvent.id));
  expect(Number(leftovers[0].n)).toBe(0);
  const guestLeft = await db.select().from(inviteeGuests).where(eq(inviteeGuests.scheduledEventId, booking.scheduledEvent.id));
  expect(guestLeft).toHaveLength(0);
  const hostLeft = await db
    .select()
    .from(scheduledEventHosts)
    .where(eq(scheduledEventHosts.scheduledEventId, booking.scheduledEvent.id));
  expect(hostLeft).toHaveLength(0);

  // Deleting a poll's event type cascades to the poll and its votes.
  await db.delete(eventTypes).where(eq(eventTypes.id, poll.eventType.id));
  const votes = await db.select().from(meetingPollVotes).where(eq(meetingPollVotes.pollId, poll.poll.id));
  expect(votes).toHaveLength(0);

  // Calendar busy rows are reachable by the busy index columns.
  const busy = await db
    .select()
    .from(externalEvents)
    .where(and(eq(externalEvents.userId, owner.id), eq(externalEvents.busy, true)));
  expect(busy).toHaveLength(1);
}
