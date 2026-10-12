// Meeting loading helpers of the lifecycle module: one meeting with its event type, hosts (with their profile),
// invitees, guests and poll, in a few indexed queries (ARCHITECTURE 26 rule 13: no N+1).
import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { eventTypes, inviteeGuests, invitees, meetingPolls, scheduledEventHosts, scheduledEvents, users } from "@/db/schema";
import { isUuid } from "@/lib/ids";

export type MeetingRow = typeof scheduledEvents.$inferSelect;
export type InviteeRow = typeof invitees.$inferSelect;
export type GuestRow = typeof inviteeGuests.$inferSelect;

export type MeetingHost = {
  userId: string;
  role: "organizer" | "cohost" | "assigned";
  poolId: string | null;
  isActive: boolean;
  name: string;
  email: string;
  timezone: string;
  timeFormat: string;
  locale: string;
};

export type MeetingEventType = {
  id: string;
  name: string;
  slug: string;
  kind: "solo" | "group";
  type: "standard" | "adhoc";
  poolingType: string | null;
  active: boolean;
  deletedAt: Date | null;
  ownerUserId: string | null;
  calendarEventTitleTemplate: string | null;
  durationMinutes: number;
  durationOptions: number[] | null;
  locations: (typeof eventTypes.$inferSelect)["locations"];
};

export type MeetingBundle = {
  meeting: MeetingRow;
  eventType: MeetingEventType | null;
  /** Organizer first, then the other hosts in creation order. */
  hosts: MeetingHost[];
  organizer: MeetingHost | null;
  invitees: InviteeRow[];
  guests: GuestRow[];
  poll: { id: string; title: string; hideInvitees: boolean } | null;
};

export async function loadMeeting(db: DbOrTx, scheduledEventId: string): Promise<MeetingBundle | null> {
  if (!isUuid(scheduledEventId)) return null;
  const [meeting] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).limit(1);
  if (!meeting) return null;
  const [etRows, hostRows, inviteeRows, guestRows, pollRows] = await Promise.all([
    db
      .select({
        id: eventTypes.id,
        name: eventTypes.name,
        slug: eventTypes.slug,
        kind: eventTypes.kind,
        type: eventTypes.type,
        poolingType: eventTypes.poolingType,
        active: eventTypes.active,
        deletedAt: eventTypes.deletedAt,
        ownerUserId: eventTypes.ownerUserId,
        calendarEventTitleTemplate: eventTypes.calendarEventTitleTemplate,
        durationMinutes: eventTypes.durationMinutes,
        durationOptions: eventTypes.durationOptions,
        locations: eventTypes.locations,
      })
      .from(eventTypes)
      .where(eq(eventTypes.id, meeting.eventTypeId))
      .limit(1),
    db
      .select({
        userId: scheduledEventHosts.userId,
        role: scheduledEventHosts.role,
        poolId: scheduledEventHosts.poolId,
        isActive: scheduledEventHosts.isActive,
        name: users.name,
        email: users.email,
        timezone: users.timezone,
        timeFormat: users.timeFormat,
        locale: users.locale,
      })
      .from(scheduledEventHosts)
      .innerJoin(users, eq(users.id, scheduledEventHosts.userId))
      .where(eq(scheduledEventHosts.scheduledEventId, meeting.id))
      .orderBy(asc(scheduledEventHosts.createdAt)),
    db.select().from(invitees).where(eq(invitees.scheduledEventId, meeting.id)).orderBy(asc(invitees.createdAt), asc(invitees.id)),
    db.select().from(inviteeGuests).where(eq(inviteeGuests.scheduledEventId, meeting.id)).orderBy(asc(inviteeGuests.createdAt)),
    meeting.pollId
      ? db
          .select({ id: meetingPolls.id, title: meetingPolls.title, hideInvitees: meetingPolls.hideInvitees })
          .from(meetingPolls)
          .where(eq(meetingPolls.id, meeting.pollId))
          .limit(1)
      : Promise.resolve([] as { id: string; title: string; hideInvitees: boolean }[]),
  ]);
  const hosts = [...hostRows].sort((a, b) => Number(b.userId === meeting.organizerUserId) - Number(a.userId === meeting.organizerUserId));
  return {
    meeting,
    eventType: etRows[0] ?? null,
    hosts,
    organizer: hosts.find((h) => h.userId === meeting.organizerUserId) ?? hosts[0] ?? null,
    invitees: inviteeRows,
    guests: guestRows,
    poll: pollRows[0] ?? null,
  };
}

export const activeInvitees = (b: MeetingBundle): InviteeRow[] => b.invitees.filter((i) => i.status === "active");

/** Guests of one invitee that are still invited (canceled_at null). */
export const guestsOf = (b: MeetingBundle, inviteeId: string, opts: { includeCanceled?: boolean } = {}): GuestRow[] =>
  b.guests.filter((g) => g.inviteeId === inviteeId && (opts.includeCanceled || !g.canceledAt));

/** The host user ids of a meeting (lock order step 1). */
export async function meetingHostIds(db: DbOrTx, scheduledEventIds: string[]): Promise<string[]> {
  const ids = scheduledEventIds.filter(isUuid);
  if (!ids.length) return [];
  const rows = await db
    .select({ userId: scheduledEventHosts.userId })
    .from(scheduledEventHosts)
    .where(inArray(scheduledEventHosts.scheduledEventId, ids));
  return [...new Set(rows.map((r) => r.userId))];
}

/** The invitee and its meeting id, or null (capability ids from URLs: malformed is unknown). */
export async function loadInvitee(db: DbOrTx, inviteeId: string): Promise<InviteeRow | null> {
  if (!isUuid(inviteeId)) return null;
  const [row] = await db.select().from(invitees).where(eq(invitees.id, inviteeId)).limit(1);
  return row ?? null;
}
