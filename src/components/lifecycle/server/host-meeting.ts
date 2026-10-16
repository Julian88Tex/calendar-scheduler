// The host dialogs' view of a meeting (SPEC CR-06, CR-07, CR-08, CR-11, CR-14). Server only. Authorized: null unless the
// actor manages the meeting (organizer, a host, an editor of its event type or an org admin, meetingAccess), so
// other tenants' meetings are not found.
import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { eventTypes, inviteeNoShows, invitees, scheduledEventHosts, scheduledEvents } from "@/db/schema";
import { meetingAccess, type ActorCtx } from "@/lib/authz";
import { isUuid } from "@/lib/ids";
import { hour12For } from "@/lib/time/format";
import { isValidTimeZone } from "@/lib/time/zones";
import type { HostMeetingSummary } from "../types";

export async function loadHostMeetingSummary(actor: ActorCtx, scheduledEventId: string): Promise<HostMeetingSummary | null> {
  if (!isUuid(scheduledEventId)) return null;
  const db = await getDb();
  if ((await meetingAccess(actor, scheduledEventId, db)) !== "manage") return null;
  const [m] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).limit(1);
  if (!m) return null;
  const [etRows, hostRows, inviteeRows] = await Promise.all([
    db.select({ active: eventTypes.active, deletedAt: eventTypes.deletedAt, type: eventTypes.type }).from(eventTypes).where(eq(eventTypes.id, m.eventTypeId)).limit(1),
    db.select({ userId: scheduledEventHosts.userId }).from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, m.id)),
    db.select().from(invitees).where(eq(invitees.scheduledEventId, m.id)).orderBy(asc(invitees.createdAt), asc(invitees.id)),
  ]);
  const ids = inviteeRows.map((i) => i.id);
  const noShows = ids.length ? await db.select({ inviteeId: inviteeNoShows.inviteeId }).from(inviteeNoShows).where(inArray(inviteeNoShows.inviteeId, ids)) : [];
  const marked = new Set(noShows.map((n) => n.inviteeId));
  const et = etRows[0];
  // Moved invitees (rescheduled away) are history, not people of this meeting.
  const people = inviteeRows.filter((i) => !i.rescheduled || i.status === "active");
  return {
    scheduledEventId: m.id,
    eventName: m.name,
    color: m.settingsSnapshot?.color ?? "#8247f5",
    start: m.startAt.toISOString(),
    end: m.endAt.toISOString(),
    durationMinutes: m.durationMinutes,
    status: m.status,
    isGroup: m.isGroup,
    source: m.source,
    eventTypeId: m.eventTypeId,
    eventTypeBookable: Boolean(et && et.active && !et.deletedAt && et.type === "standard"),
    hostCount: new Set(hostRows.map((h) => h.userId)).size,
    timeZone: isValidTimeZone(actor.user.timezone) ? actor.user.timezone : "UTC",
    hour12: hour12For(actor.user.timeFormat, "en-US"),
    invitees: people.map((i) => ({
      id: i.id,
      name: i.name,
      email: i.email,
      timezone: isValidTimeZone(i.timezone) ? i.timezone : null,
      status: i.status,
      noShow: marked.has(i.id),
    })),
    notesHtml: m.meetingNotesHtml ?? null,
  };
}
