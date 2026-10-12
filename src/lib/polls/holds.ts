// Reserve times (SPEC MP-25, SCH-19; research meeting-polls.md B12). Server only.
//
// - getPollReservedIntervals: the slot engine's "reserved" busy source. Options of open or closed polls with Reserve
//   times on are busy for the owner and every co-host, whether or not a calendar is connected, so regular event types
//   cannot be booked over them. Date-only options block the whole local day in the poll zone.
// - syncPollHolds (job polls.holds_sync): the calendar copies, "Reserved: {Poll title}" busy private events without
//   attendees on each host's writable destination calendar, one per future option within 365 days
//   (calendar_linked_events purpose poll_hold through calendars.upsertLinkedEvent). Removed on booking, cancel,
//   expiry, option removal or turning the setting off. Hosts without a destination calendar are skipped (shown in the
//   results page hold status); transient failures retry.
import "server-only";
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { getDb } from "@/db";
import { calendarConnections, calendarLinkedEvents, eventTypeHosts, meetingPollOptions, meetingPolls } from "@/db/schema";
import { deleteLinkedEvent, upsertLinkedEvent } from "@/lib/calendars";
import { getT } from "@/lib/i18n";
import { log } from "@/lib/logger";
import type { BusyInterval } from "@/lib/slots/types";
import { now as clockNow } from "@/lib/time/now";
import { appHost, pollUrl } from "@/lib/url";
import { OPTION_HORIZON_DAYS } from "./constants";
import { dayEnd, dayStart } from "./grid";
import { endOf, loadOptions, loadPoll, loadPollHosts, startOf, statusOf } from "./load";

const DAY = 86_400_000;

export type PollHoldInterval = BusyInterval & { pollId: string; optionId: string; userId: string };

/** Hold title in the poll's language. */
export function holdTitle(title: string, locale: string): string {
  return getT(locale, "poll-emails")("holds.title", { title });
}

/** Reserved intervals per user with their poll (the grid overlay excludes the poll being edited). */
export async function pollHoldIntervals(
  userIds: string[],
  start: Date,
  end: Date,
  opts: { db?: DbOrTx; excludePollId?: string | null } = {},
): Promise<PollHoldInterval[]> {
  const ids = [...new Set(userIds)];
  if (!ids.length || end.getTime() <= start.getTime()) return [];
  const db = opts.db ?? (await getDb());
  // Date-only options are compared by date with a day of margin, then exactly in the poll zone.
  const fromDate = new Date(start.getTime() - 2 * DAY).toISOString().slice(0, 10);
  const toDate = new Date(end.getTime() + 2 * DAY).toISOString().slice(0, 10);
  const rows = await db
    .select({
      pollId: meetingPolls.id,
      title: meetingPolls.title,
      locale: meetingPolls.locale,
      timezone: meetingPolls.timezone,
      userId: eventTypeHosts.userId,
      optionId: meetingPollOptions.id,
      startsAt: meetingPollOptions.startsAt,
      endsAt: meetingPollOptions.endsAt,
      allDayDate: meetingPollOptions.allDayDate,
    })
    .from(meetingPolls)
    .innerJoin(eventTypeHosts, eq(eventTypeHosts.eventTypeId, meetingPolls.eventTypeId))
    .innerJoin(meetingPollOptions, eq(meetingPollOptions.pollId, meetingPolls.id))
    .where(
      and(
        inArray(eventTypeHosts.userId, ids),
        eq(meetingPolls.reserveTimes, true),
        inArray(meetingPolls.status, ["open", "closed"]),
        isNull(meetingPolls.deletedAt),
        isNull(meetingPollOptions.deletedAt),
        opts.excludePollId ? ne(meetingPolls.id, opts.excludePollId) : undefined,
        or(
          and(isNotNull(meetingPollOptions.startsAt), lt(meetingPollOptions.startsAt, end), gt(meetingPollOptions.endsAt, start)),
          and(isNotNull(meetingPollOptions.allDayDate), gte(meetingPollOptions.allDayDate, fromDate), lte(meetingPollOptions.allDayDate, toDate)),
        ),
      ),
    );
  const out: PollHoldInterval[] = [];
  for (const r of rows) {
    const s = r.allDayDate ? dayStart(r.allDayDate, r.timezone) : r.startsAt!.getTime();
    const e = r.allDayDate ? dayEnd(r.allDayDate, r.timezone) : r.endsAt!.getTime();
    if (s >= end.getTime() || e <= start.getTime()) continue;
    out.push({ start: s, end: e, source: "reserved", reservedKind: "poll", title: holdTitle(r.title, r.locale), pollId: r.pollId, optionId: r.optionId, userId: r.userId });
  }
  return out;
}

/** Contract implementation (index.ts): reserved busy per user. */
export async function reservedIntervalsByUser(userIds: string[], start: Date, end: Date): Promise<Record<string, BusyInterval[]>> {
  const out: Record<string, BusyInterval[]> = {};
  for (const h of await pollHoldIntervals(userIds, start, end)) {
    const list = (out[h.userId] ??= []);
    list.push({ start: h.start, end: h.end, source: "reserved", reservedKind: "poll", title: h.title });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

export type HoldSyncOutcome = { created: number; deleted: number; pending: number; failed: number; skipped: number };

/** Creates and removes provider holds so they match the poll (see the file header). */
export async function syncPollHolds(pollId: string): Promise<HoldSyncOutcome> {
  const db = await getDb();
  const out: HoldSyncOutcome = { created: 0, deleted: 0, pending: 0, failed: 0, skipped: 0 };
  const poll = await loadPoll(db, pollId);
  const existing = await db
    .select({ id: calendarLinkedEvents.id, userId: calendarLinkedEvents.userId, optionId: calendarLinkedEvents.pollOptionId, status: calendarLinkedEvents.status })
    .from(calendarLinkedEvents)
    .where(and(eq(calendarLinkedEvents.pollId, pollId), eq(calendarLinkedEvents.purpose, "poll_hold"), ne(calendarLinkedEvents.status, "deleted")));
  const now = clockNow();
  const wanted = new Map<string, { userId: string; optionId: string; start: Date; end: Date; allDayDate: string | null }>();
  if (poll && !poll.deletedAt && poll.reserveTimes) {
    const options = await loadOptions(db, pollId);
    const status = statusOf(poll, options, now);
    if (status === "open" || status === "closed") {
      const hosts = await loadPollHosts(db, poll);
      const horizon = now.getTime() + OPTION_HORIZON_DAYS * DAY;
      for (const o of options) {
        const s = startOf(o, poll.timezone);
        if (s <= now.getTime() || s > horizon) continue;
        for (const h of hosts) {
          wanted.set(`${h.userId}:${o.id}`, { userId: h.userId, optionId: o.id, start: new Date(s), end: new Date(endOf(o, poll.timezone)), allDayDate: o.allDayDate });
        }
      }
    }
  }
  // Remove holds that are no longer wanted.
  for (const row of existing) {
    if (row.optionId && wanted.has(`${row.userId}:${row.optionId}`)) continue;
    try {
      await deleteLinkedEvent({ linkedEventId: row.id, notifyAttendees: false });
      out.deleted++;
    } catch (e) {
      log.warn("polls.hold_delete_failed", { pollId, linkedEventId: row.id, error: e });
      out.pending++;
    }
  }
  if (!poll || !wanted.size) return out;
  const have = new Set(existing.filter((r) => r.status === "synced" && r.optionId).map((r) => `${r.userId}:${r.optionId}`));
  const link = pollUrl(poll.slug);
  const t = getT(poll.locale, "poll-emails");
  for (const [key, w] of wanted) {
    if (have.has(key)) continue;
    try {
      const res = await upsertLinkedEvent({
        userId: w.userId,
        purpose: "poll_hold",
        pollId,
        pollOptionId: w.optionId,
        event: {
          title: holdTitle(poll.title, poll.locale),
          descriptionText: t("holds.description", { link }),
          location: null,
          start: w.start,
          end: w.end,
          ...(w.allDayDate ? { allDay: true, allDayDate: w.allDayDate } : {}),
          attendees: [],
          sendInvitations: false,
          conference: null,
          transparency: "busy",
          visibility: "private",
          icalUid: `poll-hold-${w.optionId}-${w.userId}@${appHost().replace(/:\d+$/, "") || "localhost"}`,
        },
      });
      if (res.status === "synced") out.created++;
      else if (res.status === "pending") out.pending++;
      else if (res.status === "failed") out.failed++;
      else out.skipped++;
    } catch (e) {
      log.warn("polls.hold_write_failed", { pollId, userId: w.userId, optionId: w.optionId, error: e });
      out.failed++;
    }
  }
  return out;
}

/** Results page hold status ("Couldn't reserve {n} times on {Provider}. Retry"). */
export async function holdsSummary(db: DbOrTx, pollId: string): Promise<{ active: number; pending: number; failed: number; provider: string | null }> {
  const rows = await db
    .select({ status: calendarLinkedEvents.status, provider: calendarConnections.provider })
    .from(calendarLinkedEvents)
    .leftJoin(calendarConnections, eq(calendarConnections.id, calendarLinkedEvents.connectionId))
    .where(and(eq(calendarLinkedEvents.pollId, pollId), eq(calendarLinkedEvents.purpose, "poll_hold"), ne(calendarLinkedEvents.status, "deleted")));
  const provider = rows.find((r) => r.provider)?.provider ?? null;
  const names: Record<string, string> = { google: "Google Calendar", microsoft: "Outlook Calendar", caldav: "CalDAV" };
  return {
    active: rows.filter((r) => r.status === "synced").length,
    pending: rows.filter((r) => r.status === "pending").length,
    failed: rows.filter((r) => r.status === "failed").length,
    provider: provider ? (names[provider] ?? provider) : null,
  };
}

