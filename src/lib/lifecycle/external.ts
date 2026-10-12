// Host-side changes in the connected calendar (SPEC CAL-13, CAL-14, CR-17; the owner's observed Calendly behavior:
// moving the Google event reschedules the booking, deleting it cancels it). Called by calendar-integrations' 10 minute
// sync and push notifications with one change of a provider event this app wrote:
//
//   deleted / declined   the meeting is canceled by the host with reason "Canceled from connected calendar event";
//                        invitees get the standard cancellation emails.
//   moved                the meeting is rescheduled: the old meeting is canceled with reason "Rescheduled from
//                        connected calendar event" (canceler host) and a new meeting at the new time takes its place,
//                        with linked invitees (CR-04), the same ICS UID with SEQUENCE + 1, the same conference and the
//                        SAME provider event (repointLinkedEvents; no provider write: it already shows the new time).
//                        Invitees get the standard reschedule emails. Poll, one-off and group meetings move in place
//                        (moveScheduledEvent) because other records point at that meeting.
//   buffer events        (CAL-13) only the meeting's buffer changes: deleted removes it, moved or resized sets its length.
//
// Changes on a co-host's copy are ignored (only the organizer's event drives the meeting). Invitee-side changes never
// reach this function.
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarLinkedEvents, inviteeGuests, invitees, scheduledEventHosts, scheduledEvents, users } from "@/db/schema";
import { lockHostsInTx, lockInviteeForChangeInTx, type InviteeRow } from "@/lib/booking";
import { repointLinkedEvents } from "@/lib/calendars";
import { isAppError } from "@/lib/errors";
import { eventJobPattern, publishEvent } from "@/lib/events";
import messages from "@/lib/i18n/messages/en/lifecycle";
import { isUuid, newId } from "@/lib/ids";
import { runJobsAfterResponse } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { recordActivity } from "./activity";
import { cancelMeeting } from "./cancel";
import { meetingHostIds } from "./load";
import { moveScheduledEvent } from "./reschedule";
import { meetingMetaOf, type ExternalCalendarChange, type LifecycleActor, type LifecycleMeetingMeta } from "./types";

const SYSTEM: LifecycleActor = { type: "system", name: "Connected calendar" };
const MAX_BUFFER_MINUTES = 720;
const MAX_MEETING_MINUTES = 720;

/** CAL-14 / CR-17 (see the file header). */
export async function applyExternalCalendarChange(p: { linkedEventId: string; change: ExternalCalendarChange }): Promise<void> {
  if (!isUuid(p.linkedEventId)) return;
  const db = await getDb();
  const [row] = await db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, p.linkedEventId)).limit(1);
  if (!row?.scheduledEventId) return;
  const [m] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, row.scheduledEventId)).limit(1);
  if (!m || m.status !== "active") return;
  if (row.userId !== m.organizerUserId) {
    log.info("lifecycle.external_change_ignored", { linkedEventId: row.id, reason: "not_organizer" });
    return;
  }
  if (row.purpose === "buffer_before" || row.purpose === "buffer_after") {
    await adjustBuffer(m.id, row.purpose, p.change);
    return;
  }
  if (row.purpose !== "meeting") return;
  const [organizer] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, m.organizerUserId)).limit(1);
  const canceler = { type: "host" as const, userId: m.organizerUserId, name: organizer?.name ?? null };
  if (p.change.type === "deleted" || p.change.type === "declined") {
    await cancelMeeting({ scheduledEventId: m.id, actor: SYSTEM, reason: messages.reasons.calendarCanceled, kind: "calendar", canceler });
    return;
  }
  const start = new Date(p.change.start);
  const end = new Date(p.change.end);
  if (!(end > start) || (start.getTime() === m.startAt.getTime() && end.getTime() === m.endAt.getTime())) return;
  if (end.getTime() - start.getTime() > MAX_MEETING_MINUTES * 60_000) {
    log.warn("lifecycle.external_move_too_long", { scheduledEventId: m.id });
    return;
  }
  if (m.source === "poll" || m.source === "one_off" || m.isGroup) {
    await moveScheduledEvent({ scheduledEventId: m.id, start, end, actor: SYSTEM });
    return;
  }
  const out = await rescheduleFromCalendar(m.id, start, end, canceler);
  if (!out) return;
  // The same provider event now belongs to the new meeting (it already shows the new time).
  await repointLinkedEvents({ fromScheduledEventId: m.id, toScheduledEventId: out.newScheduledEventId });
  runJobsAfterResponse({ types: [eventJobPattern("booking.rescheduled")] });
}

type Canceler = { type: "host"; userId: string; name: string | null };

/** Copies the meeting to its new time and cancels and links the old one, in one transaction. */
async function rescheduleFromCalendar(scheduledEventId: string, start: Date, end: Date, canceler: Canceler): Promise<{ newScheduledEventId: string } | null> {
  const db = await getDb();
  const hostIds = await meetingHostIds(db, [scheduledEventId]);
  const at = now();
  const reason = messages.reasons.calendarRescheduled;
  return db.transaction(
    async (tx) => {
      await lockHostsInTx(tx, hostIds);
      const candidates = await tx
        .select({ id: invitees.id })
        .from(invitees)
        .where(and(eq(invitees.scheduledEventId, scheduledEventId), eq(invitees.status, "active")))
        .orderBy(asc(invitees.id));
      const locked: InviteeRow[] = [];
      for (const c of candidates) {
        try {
          locked.push(await lockInviteeForChangeInTx(tx, c.id));
        } catch (e) {
          if (!isAppError(e) || e.code !== "conflict") throw e;
        }
      }
      const [m] = await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).for("update").limit(1);
      if (!m || m.status !== "active" || !locked.length) return null;
      if (m.startAt.getTime() === start.getTime() && m.endAt.getTime() === end.getTime()) return null;
      const hosts = await tx.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, m.id));
      const guests = await tx.select().from(inviteeGuests).where(eq(inviteeGuests.scheduledEventId, m.id));
      const id = newId();
      const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
      const meta = meetingMetaOf(m.metadata);
      const { lifecycle: _old, ...otherMeta } = m.metadata ?? {};
      void _old;
      const lifecycle: LifecycleMeetingMeta = { origin: "calendar_sync", calendar: meta.calendar, provision: { startedAt: at.toISOString() } };
      await tx.insert(scheduledEvents).values({
        ...m,
        id,
        status: "active",
        startAt: start,
        endAt: end,
        durationMinutes: minutes,
        icsSequence: m.icsSequence + 1,
        rescheduledFromEventId: m.id,
        canceledAt: null,
        cancelReason: null,
        cancelerType: null,
        canceledByUserId: null,
        canceledByName: null,
        metadata: { ...otherMeta, lifecycle },
        createdAt: at,
        updatedAt: at,
      });
      await tx.insert(scheduledEventHosts).values(
        hosts.map((h) => ({
          scheduledEventId: id,
          userId: h.userId,
          eventTypeId: h.eventTypeId,
          poolId: h.poolId,
          role: h.role,
          isActive: true,
          startAt: start,
          endAt: end,
          bufferedStartAt: new Date(start.getTime() - m.bufferBeforeMinutes * 60_000),
          bufferedEndAt: new Date(end.getTime() + m.bufferAfterMinutes * 60_000),
          assignmentReason: h.assignmentReason,
          // SCH-16: the assignment time moves with the meeting.
          assignedAt: h.assignedAt,
        })),
      );
      const pairs: { old: InviteeRow; next: string }[] = [];
      for (const inv of locked) {
        const next = newId();
        pairs.push({ old: inv, next });
        const { lifecycle: _l, ...invMeta } = inv.metadata ?? {};
        void _l;
        await tx.insert(invitees).values({
          ...inv,
          id: next,
          scheduledEventId: id,
          status: "active",
          rescheduled: false,
          oldInviteeId: inv.id,
          newInviteeId: null,
          canceledAt: null,
          cancelReason: null,
          cancelerType: null,
          canceledByUserId: null,
          canceledByName: null,
          rescheduleReason: null,
          clientRequestId: null,
          reservationId: null,
          metadata: invMeta,
          createdAt: at,
          updatedAt: at,
        });
        const own = guests.filter((g) => g.inviteeId === inv.id && !g.canceledAt);
        if (own.length) {
          await tx.insert(inviteeGuests).values(own.map((g) => ({ inviteeId: next, scheduledEventId: id, email: g.email, emailNormalized: g.emailNormalized })));
        }
        await tx
          .update(invitees)
          .set({
            status: "canceled",
            rescheduled: true,
            newInviteeId: next,
            canceledAt: at,
            cancelReason: reason,
            rescheduleReason: reason,
            cancelerType: "host",
            canceledByUserId: canceler.userId,
            canceledByName: canceler.name,
            updatedAt: at,
          })
          .where(eq(invitees.id, inv.id));
      }
      await tx
        .update(scheduledEvents)
        .set({ status: "canceled", canceledAt: at, cancelReason: reason, cancelerType: "host", canceledByUserId: canceler.userId, canceledByName: canceler.name, updatedAt: at })
        .where(eq(scheduledEvents.id, m.id));
      await tx.update(scheduledEventHosts).set({ isActive: false, updatedAt: at }).where(eq(scheduledEventHosts.scheduledEventId, m.id));
      await recordActivity(tx, [
        ...pairs.map(({ old, next }) => ({
          scheduledEventId: m.id,
          inviteeId: old.id,
          type: "rescheduled_to" as const,
          actor: SYSTEM,
          data: { toInviteeId: next, toScheduledEventId: id, reason, source: "calendar_sync" },
        })),
        ...pairs.map(({ old, next }) => ({
          scheduledEventId: id,
          inviteeId: next,
          type: "rescheduled_from" as const,
          actor: SYSTEM,
          data: { fromInviteeId: old.id, fromScheduledEventId: m.id, reason, source: "calendar_sync" },
        })),
      ]);
      for (const { old, next } of pairs) {
        await publishEvent(
          tx,
          "booking.rescheduled",
          { oldInviteeId: old.id, newInviteeId: next, oldScheduledEventId: m.id, newScheduledEventId: id, reason },
          { organizationId: m.organizationId, actor: { type: "system", name: "Connected calendar" } },
        );
      }
      return { newScheduledEventId: id };
    },
    { isolationLevel: "read committed" },
  );
}

/** CAL-13: a buffer event deleted or resized in the connected calendar changes the meeting's buffer. */
async function adjustBuffer(scheduledEventId: string, purpose: "buffer_before" | "buffer_after", change: ExternalCalendarChange): Promise<void> {
  const minutes =
    change.type === "moved"
      ? Math.max(0, Math.min(MAX_BUFFER_MINUTES, Math.round((new Date(change.end).getTime() - new Date(change.start).getTime()) / 60_000)))
      : 0;
  const db = await getDb();
  const hostIds = await meetingHostIds(db, [scheduledEventId]);
  const at = now();
  const changed = await db.transaction(async (tx) => {
    await lockHostsInTx(tx, hostIds);
    const [m] = await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).for("update").limit(1);
    if (!m || m.status !== "active") return false;
    const before = purpose === "buffer_before" ? minutes : m.bufferBeforeMinutes;
    const after = purpose === "buffer_after" ? minutes : m.bufferAfterMinutes;
    if (before === m.bufferBeforeMinutes && after === m.bufferAfterMinutes) return false;
    await tx.update(scheduledEvents).set({ bufferBeforeMinutes: before, bufferAfterMinutes: after, updatedAt: at }).where(eq(scheduledEvents.id, m.id));
    await tx
      .update(scheduledEventHosts)
      .set({ bufferedStartAt: new Date(m.startAt.getTime() - before * 60_000), bufferedEndAt: new Date(m.endAt.getTime() + after * 60_000), updatedAt: at })
      .where(eq(scheduledEventHosts.scheduledEventId, m.id));
    await recordActivity(tx, [
      { scheduledEventId: m.id, type: "buffers_changed", actor: SYSTEM, data: { before, after, previous: { before: m.bufferBeforeMinutes, after: m.bufferAfterMinutes }, source: "calendar_sync" } },
    ]);
    await publishEvent(tx, "meeting.updated", { scheduledEventId: m.id, fields: ["buffers"] }, { organizationId: m.organizationId, actor: { type: "system", name: "Connected calendar" } });
    return true;
  });
  if (changed) runJobsAfterResponse({ types: [eventJobPattern("meeting.updated")] });
}
