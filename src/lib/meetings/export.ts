// CSV export of the current tab and filters (SPEC MT-11, CR-14; ARCHITECTURE 26 rule 13). Server only.
//
// exportCsvLines(actor, query) yields the file line by line: a UTF-8 byte order mark and the MT-11 header, then one row
// per invitee of every meeting the Meetings page would list (same visibility, tab window and filters, list order),
// read in keyset batches so memory stays flat. With "Active events" only, canceled invitees of active group slots are
// left out; with "Canceled events" every invitee of the canceled meetings is exported. Meeting notes are exported only
// for meetings the viewer manages (CR-14: hosts and editors). The route handler streams the lines as they come
// (docs/SCOPE.md: no background export job; one person's meetings fit a streamed response).
import "server-only";
import { and, asc, inArray, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { eventTypes, inviteeGuests, inviteeNoShows, invitees, scheduledEventHosts, scheduledEvents, teams, users } from "@/db/schema";
import { eventTypeAccess, isOrgAdmin, type ActorCtx, type EventTypeAccess } from "@/lib/authz";
import { isUuid } from "@/lib/ids";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { isValidTimeZone } from "@/lib/time/zones";
import { CSV_HEADER, csvLine, csvRow } from "./csv";
import type { MeetingsQuery } from "./filters";
import { cancelerOf, locationText } from "./present";
import { cursorOf, filterConditions, keysetCondition, orderBy, readCursor, resolveRange, sortDirOf, todayIn, viewerContext, visibleCondition } from "./queries";

/** Rows per file (a safety bound for one streamed response). */
export const MAX_EXPORT_ROWS = 50_000;
const BATCH = 200;

export async function* exportCsvLines(actor: ActorCtx, input: MeetingsQuery, opts: { db?: DbOrTx; now?: Date } = {}): AsyncGenerator<string> {
  const db = opts.db ?? (await getDb());
  const ctx = viewerContext(actor, opts.now ?? now());
  const q: MeetingsQuery = input.tab === "range" ? { ...input, ...resolveRange(input, todayIn(ctx)) } : input;
  const where = and(visibleCondition(db, actor), ...filterConditions(db, q, ctx))!;
  const dir = sortDirOf(q.tab);
  const includeCanceled = q.status.includes("canceled");
  const etAccess = new Map<string, EventTypeAccess | null>();

  yield `﻿${csvLine(CSV_HEADER)}`;
  let cursor: string | null = null;
  let written = 0;
  for (;;) {
    const c = readCursor(cursor);
    const rows = await db
      .select()
      .from(scheduledEvents)
      .where(c ? and(where, keysetCondition(dir, c, "after")) : where)
      .orderBy(...orderBy(dir))
      .limit(BATCH);
    if (rows.length === 0) break;
    const ids = rows.map((r) => r.id);
    const etIds = [...new Set(rows.map((r) => r.eventTypeId))];
    const [inviteeRows, guestRows, hostRows, etRows] = await Promise.all([
      db.select().from(invitees).where(inArray(invitees.scheduledEventId, ids)).orderBy(asc(invitees.createdAt), asc(invitees.id)),
      db
        .select({ inviteeId: inviteeGuests.inviteeId, email: inviteeGuests.email })
        .from(inviteeGuests)
        .where(and(inArray(inviteeGuests.scheduledEventId, ids), isNull(inviteeGuests.canceledAt)))
        .orderBy(asc(inviteeGuests.createdAt), asc(inviteeGuests.id)),
      db.select({ scheduledEventId: scheduledEventHosts.scheduledEventId, userId: scheduledEventHosts.userId }).from(scheduledEventHosts).where(inArray(scheduledEventHosts.scheduledEventId, ids)),
      db.select({ id: eventTypes.id, teamId: eventTypes.teamId }).from(eventTypes).where(inArray(eventTypes.id, etIds)),
    ]);
    const inviteeIds = inviteeRows.map((i) => i.id);
    const userIds = new Set<string>();
    for (const r of rows) {
      userIds.add(r.organizerUserId);
      if (r.canceledByUserId) userIds.add(r.canceledByUserId);
    }
    for (const i of inviteeRows) {
      if (i.canceledByUserId) userIds.add(i.canceledByUserId);
      if (i.scheduledByUserId) userIds.add(i.scheduledByUserId);
    }
    const teamIds = [...new Set(etRows.map((e) => e.teamId).filter((t): t is string => Boolean(t)))];
    const [noShowRows, userRows, teamRows] = await Promise.all([
      inviteeIds.length ? db.select({ inviteeId: inviteeNoShows.inviteeId }).from(inviteeNoShows).where(inArray(inviteeNoShows.inviteeId, inviteeIds)) : [],
      db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, [...userIds].filter(isUuid))),
      teamIds.length ? db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds)) : [],
    ]);
    await Promise.all(etIds.filter((id) => !etAccess.has(id)).map(async (id) => etAccess.set(id, await eventTypeAccess(actor, id, db))));

    const noShows = new Set(noShowRows.map((n) => n.inviteeId));
    const people = new Map(userRows.map((u) => [u.id, u]));
    const names = new Map(userRows.map((u) => [u.id, u.name]));
    const teamOf = new Map(etRows.map((e) => [e.id, e.teamId ? (teamRows.find((t) => t.id === e.teamId)?.name ?? null) : null]));
    const guests = new Map<string, string[]>();
    for (const g of guestRows) guests.set(g.inviteeId, [...(guests.get(g.inviteeId) ?? []), g.email]);
    const hostIds = new Map<string, Set<string>>();
    for (const h of hostRows) hostIds.set(h.scheduledEventId, (hostIds.get(h.scheduledEventId) ?? new Set()).add(h.userId));

    for (const m of rows) {
      const organizer = people.get(m.organizerUserId);
      const et = etAccess.get(m.eventTypeId) ?? null;
      const manage = m.organizerUserId === actor.user.id || hostIds.get(m.id)?.has(actor.user.id) || isOrgAdmin(actor) || et === "owner" || et === "edit";
      for (const i of inviteeRows) {
        if (i.scheduledEventId !== m.id) continue;
        if (i.status !== "active" && !includeCanceled) continue;
        if (written >= MAX_EXPORT_ROWS) {
          log.warn("meetings.export_truncated", { userId: actor.user.id, rows: written });
          return;
        }
        const canceled = i.status === "canceled";
        const canceler = canceled
          ? cancelerOf(
              i.cancelerType ? { type: i.cancelerType, userId: i.canceledByUserId, name: i.canceledByName } : { type: m.cancelerType, userId: m.canceledByUserId, name: m.canceledByName },
              i,
              names,
            )
          : null;
        const questions = [...(i.questionsAndAnswers ?? [])]
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((qa) => ({ question: qa.question ?? "", answer: qa.answer ?? "" }));
        yield csvLine(
          csvRow(
            {
              userName: organizer?.name ?? "",
              team: teamOf.get(m.eventTypeId) ?? null,
              inviteeName: i.name,
              firstName: i.firstName,
              lastName: i.lastName,
              email: i.email,
              inviteeTimeZone: isValidTimeZone(i.timezone) ? i.timezone : null,
              marketingConsent: i.marketingConsent,
              textReminderNumber: i.textReminderNumber,
              eventTypeName: m.name,
              start: m.startAt,
              end: m.endAt,
              location: locationText(m.location),
              createdAt: i.createdAt,
              canceled,
              canceledBy: canceler?.name ?? null,
              cancelReason: canceled ? (i.cancelReason ?? m.cancelReason ?? null) : null,
              questions,
              utmCampaign: i.utmCampaign,
              utmSource: i.utmSource,
              utmMedium: i.utmMedium,
              utmTerm: i.utmTerm,
              utmContent: i.utmContent,
              salesforceUuid: i.salesforceUuid,
              price: null,
              currency: null,
              guests: guests.get(i.id) ?? [],
              reconfirmed: Boolean(i.reconfirmedAt),
              noShow: noShows.has(i.id),
              notes: manage ? (m.meetingNotesPlain ?? null) : null,
              group: m.isGroup,
              userEmail: organizer?.email ?? "",
              eventId: m.id,
              inviteeId: i.id,
              scheduledBy: i.scheduledByUserId ? (names.get(i.scheduledByUserId) ?? null) : null,
              schedulingMethod: i.schedulingMethod,
            },
            ctx.zone,
          ),
        );
        written++;
      }
    }
    if (rows.length < BATCH) break;
    cursor = cursorOf(rows[rows.length - 1]!);
  }
}
