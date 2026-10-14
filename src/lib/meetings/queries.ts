// Read model of the Meetings page (SPEC MT-01, MT-02, MT-05 to MT-08, MT-13, MT-15; ARCHITECTURE 18.7, 26 rules 5,
// 13 and 20). Server only.
//
// Which meetings: the viewer's own (organizer or host) and the meetings of event types shared with them through
// event_type_permissions, always inside their organization. docs/SCOPE.md has one person and no team, so the
// "My {AppName}" switch to other users and teams is not offered. Access per meeting follows meetingAccess: hosts, the
// organizer, event type editors and org admins manage; event type viewers only view (MT-07).
//
// Tabs (business clock now(), never the database clock): Upcoming = end in the future, ascending; Past = end passed,
// descending; Date Range = start within the local dates in the viewer's zone, ascending. Filters: Status (active,
// canceled), Event Types, Invitee Emails, search (invitee name or email, event name). Keyset pagination, 25 per page,
// by (start_at, id); the counter comes from a count of the same filters.
//
// Deep links (?event=id, the "View event" links of host emails): without an explicit tab the meeting's own tab opens
// (Past when it ended), canceled meetings bring "Canceled events" into the Status filter, and the page that holds the
// meeting is shown. A meeting that the explicit filters hide is shown pinned above the list.
import "server-only";
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { eventTypePermissions, eventTypes, inviteeGuests, inviteeNoShows, invitees, scheduledEventHosts, scheduledEvents, users } from "@/db/schema";
import { eventTypeAccess, isOrgAdmin, type ActorCtx } from "@/lib/authz";
import { fileUrl } from "@/lib/files";
import { isUuid } from "@/lib/ids";
import { inviteeMetaOf } from "@/lib/lifecycle/types";
import { decodeCursor, encodeCursor } from "@/lib/pagination";
import { hour12For } from "@/lib/time/format";
import { addDays, startOfLocalDay } from "@/lib/time/luxon";
import { now } from "@/lib/time/now";
import { friendlyZoneName, isValidTimeZone } from "@/lib/time/zones";
import { absoluteUrl } from "@/lib/url";
import { PAGE_SIZE, type MeetingsQuery } from "./filters";
import { dayHeading, presentMeeting, type MeetingBundle, type PresentContext, type RawMeeting } from "./present";
import type { EventTypeOption, MeetingDayGroup, MeetingsPageData, MeetingView } from "./types";

export type ViewerContext = {
  actor: ActorCtx;
  /** Business clock. */
  now: Date;
  zone: string;
  hour12: boolean;
  dateFormat: string;
  weekStart: 0 | 1;
};

export function viewerContext(actor: ActorCtx, at: Date = now()): ViewerContext {
  const u = actor.user;
  return {
    actor,
    now: at,
    zone: isValidTimeZone(u.timezone) ? u.timezone : "UTC",
    hour12: hour12For(u.timeFormat, "en-US"),
    dateFormat: u.dateFormat === "DD/MM/YYYY" ? "DD/MM/YYYY" : "MM/DD/YYYY",
    weekStart: u.weekStart === 1 ? 1 : 0,
  };
}

/** Today in the viewer's zone. */
export function todayIn(ctx: Pick<ViewerContext, "now" | "zone">): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ctx.zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ctx.now);
}

/** The Date Range tab's dates: the URL's, or this month in the viewer's zone. */
export function resolveRange(q: MeetingsQuery, today: string): { start: string; end: string } {
  if (q.start && q.end) return { start: q.start, end: q.end };
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

/** Escapes LIKE wildcards (backslash is Postgres' default escape character). */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Meetings the viewer can see (see the file header). */
export function visibleCondition(db: DbOrTx, actor: ActorCtx): SQL {
  return and(
    eq(scheduledEvents.organizationId, actor.orgId),
    or(
      eq(scheduledEvents.organizerUserId, actor.user.id),
      inArray(scheduledEvents.id, db.select({ id: scheduledEventHosts.scheduledEventId }).from(scheduledEventHosts).where(eq(scheduledEventHosts.userId, actor.user.id))),
      inArray(scheduledEvents.eventTypeId, db.select({ id: eventTypePermissions.eventTypeId }).from(eventTypePermissions).where(eq(eventTypePermissions.userId, actor.user.id))),
    ),
  )!;
}

/** The tab window and the filters of a query (without the visibility condition and the cursor). */
export function filterConditions(db: DbOrTx, q: MeetingsQuery, ctx: Pick<ViewerContext, "now" | "zone">): SQL[] {
  const out: SQL[] = [];
  if (q.tab === "upcoming") out.push(gt(scheduledEvents.endAt, ctx.now));
  else if (q.tab === "past") out.push(lte(scheduledEvents.endAt, ctx.now));
  else {
    const range = resolveRange(q, todayIn(ctx));
    out.push(gte(scheduledEvents.startAt, startOfLocalDay(range.start, ctx.zone)));
    out.push(lt(scheduledEvents.startAt, startOfLocalDay(addDays(range.end, 1), ctx.zone)));
  }
  if (q.status.length === 1) out.push(eq(scheduledEvents.status, q.status[0]!));
  if (q.eventTypeIds.length) out.push(inArray(scheduledEvents.eventTypeId, q.eventTypeIds));
  if (q.emails.length) {
    out.push(inArray(scheduledEvents.id, db.select({ id: invitees.scheduledEventId }).from(invitees).where(inArray(invitees.emailNormalized, q.emails))));
  }
  if (q.q) {
    const p = likePattern(q.q);
    out.push(
      or(
        ilike(scheduledEvents.name, p),
        inArray(scheduledEvents.id, db.select({ id: invitees.scheduledEventId }).from(invitees).where(or(ilike(invitees.name, p), ilike(invitees.email, p)))),
      )!,
    );
  }
  return out;
}

export type SortDir = "asc" | "desc";
export const sortDirOf = (tab: MeetingsQuery["tab"]): SortDir => (tab === "past" ? "desc" : "asc");

type Cursor = { s: string; i: string };

export function cursorOf(m: Pick<RawMeeting, "startAt" | "id">): string {
  return encodeCursor({ s: m.startAt.toISOString(), i: m.id });
}

export function readCursor(value: string | null): Cursor | null {
  const c = decodeCursor<{ s: string; i: string }>(value);
  if (!c || typeof c.s !== "string" || typeof c.i !== "string" || !isUuid(c.i) || Number.isNaN(Date.parse(c.s))) return null;
  return { s: new Date(c.s).toISOString(), i: c.i };
}

/** Rows after (or before) a cursor in the list order. */
export function keysetCondition(dir: SortDir, cursor: Cursor, side: "after" | "before"): SQL {
  const op = (dir === "asc") === (side === "after") ? ">" : "<";
  return sql`(${scheduledEvents.startAt}, ${scheduledEvents.id}) ${sql.raw(op)} (${cursor.s}::timestamptz, ${cursor.i}::uuid)`;
}

export function orderBy(dir: SortDir, reverse = false) {
  const d = (dir === "asc") !== reverse ? asc : desc;
  return [d(scheduledEvents.startAt), d(scheduledEvents.id)];
}

// ---------------------------------------------------------------------------------------------------------------
// Bundles: everything a page of meetings needs, in a fixed number of batched queries (no N+1).

type HostRow = { scheduledEventId: string; userId: string; role: string; name: string; avatarFileId: string | null; avatarUrl: string | null };

const ROLE_ORDER: Record<string, number> = { organizer: 0, assigned: 1, cohost: 2 };

export async function loadBundles(db: DbOrTx, ctx: ViewerContext, rows: RawMeeting[]): Promise<MeetingBundle[]> {
  if (rows.length === 0) return [];
  const { actor } = ctx;
  const ids = rows.map((r) => r.id);
  const etIds = [...new Set(rows.map((r) => r.eventTypeId))];
  const [inviteeRows, guestRows, hostRows, etRows] = await Promise.all([
    db.select().from(invitees).where(inArray(invitees.scheduledEventId, ids)).orderBy(asc(invitees.createdAt), asc(invitees.id)),
    db
      .select({ inviteeId: inviteeGuests.inviteeId, email: inviteeGuests.email })
      .from(inviteeGuests)
      .where(and(inArray(inviteeGuests.scheduledEventId, ids), isNull(inviteeGuests.canceledAt)))
      .orderBy(asc(inviteeGuests.createdAt), asc(inviteeGuests.id)),
    db
      .select({
        scheduledEventId: scheduledEventHosts.scheduledEventId,
        userId: scheduledEventHosts.userId,
        role: scheduledEventHosts.role,
        name: users.name,
        avatarFileId: users.avatarFileId,
        avatarUrl: users.avatarUrl,
      })
      .from(scheduledEventHosts)
      .innerJoin(users, eq(users.id, scheduledEventHosts.userId))
      .where(inArray(scheduledEventHosts.scheduledEventId, ids)) as Promise<HostRow[]>,
    db
      .select({
        id: eventTypes.id,
        name: eventTypes.name,
        slug: eventTypes.slug,
        active: eventTypes.active,
        deletedAt: eventTypes.deletedAt,
        type: eventTypes.type,
        scope: eventTypes.scope,
        ownerUserId: eventTypes.ownerUserId,
      })
      .from(eventTypes)
      .where(inArray(eventTypes.id, etIds)),
  ]);

  const inviteeIds = inviteeRows.map((i) => i.id);
  const newIds = inviteeRows.filter((i) => i.rescheduled && i.newInviteeId).map((i) => i.newInviteeId!);
  const oldIds = inviteeRows.filter((i) => i.oldInviteeId).map((i) => i.oldInviteeId!);
  const userIds = new Set<string>();
  for (const r of rows) if (r.canceledByUserId) userIds.add(r.canceledByUserId);
  for (const i of inviteeRows) {
    if (i.canceledByUserId) userIds.add(i.canceledByUserId);
    if (i.scheduledByUserId) userIds.add(i.scheduledByUserId);
    const by = inviteeMetaOf(i.metadata).requestReschedule?.byUserId;
    if (by) userIds.add(by);
  }
  for (const et of etRows) if (et.ownerUserId) userIds.add(et.ownerUserId);
  const linkIds = [...new Set([...newIds, ...oldIds])].filter(isUuid);
  const [noShowRows, userRows, linkRows] = await Promise.all([
    inviteeIds.length ? db.select({ inviteeId: inviteeNoShows.inviteeId }).from(inviteeNoShows).where(inArray(inviteeNoShows.inviteeId, inviteeIds)) : [],
    userIds.size ? db.select({ id: users.id, name: users.name, slug: users.slug }).from(users).where(inArray(users.id, [...userIds].filter(isUuid))) : [],
    linkIds.length
      ? db
          .select({ inviteeId: invitees.id, eventId: scheduledEvents.id, start: scheduledEvents.startAt, end: scheduledEvents.endAt, organizationId: scheduledEvents.organizationId })
          .from(invitees)
          .innerJoin(scheduledEvents, eq(scheduledEvents.id, invitees.scheduledEventId))
          .where(inArray(invitees.id, linkIds))
      : [],
  ]);

  const noShows = new Set(noShowRows.map((n) => n.inviteeId));
  const userNames = new Map(userRows.map((u) => [u.id, u.name]));
  const userSlugs = new Map(userRows.map((u) => [u.id, u.slug]));
  // Links never cross organizations.
  const links = new Map(linkRows.filter((l) => l.organizationId === actor.orgId).map((l) => [l.inviteeId, l]));
  const guestsByInvitee = new Map<string, string[]>();
  for (const g of guestRows) {
    const list = guestsByInvitee.get(g.inviteeId) ?? [];
    if (!list.includes(g.email)) list.push(g.email);
    guestsByInvitee.set(g.inviteeId, list);
  }
  const inviteesByEvent = new Map<string, typeof inviteeRows>();
  for (const i of inviteeRows) {
    const list = inviteesByEvent.get(i.scheduledEventId) ?? [];
    list.push(i);
    inviteesByEvent.set(i.scheduledEventId, list);
  }
  const hostsByEvent = new Map<string, HostRow[]>();
  for (const h of hostRows) {
    const list = hostsByEvent.get(h.scheduledEventId) ?? [];
    list.push(h);
    hostsByEvent.set(h.scheduledEventId, list);
  }
  const etById = new Map(etRows.map((e) => [e.id, { ...e, ownerSlug: e.ownerUserId ? (userSlugs.get(e.ownerUserId) ?? null) : null }]));

  // Event type access (MT-07): one lookup per distinct event type (a page holds a handful).
  const etAccess = new Map<string, Awaited<ReturnType<typeof eventTypeAccess>>>();
  await Promise.all(etIds.map(async (id) => etAccess.set(id, await eventTypeAccess(actor, id, db))));

  return rows.map((m) => {
    const hosts = (hostsByEvent.get(m.id) ?? []).sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name));
    const isHost = m.organizerUserId === actor.user.id || hosts.some((h) => h.userId === actor.user.id);
    const et = etAccess.get(m.eventTypeId) ?? null;
    const access = isHost || isOrgAdmin(actor) || et === "owner" || et === "edit" ? "manage" : "view";
    const list = inviteesByEvent.get(m.id) ?? [];
    const moved = list.find((i) => i.rescheduled && i.newInviteeId && links.has(i.newInviteeId));
    const from = list.find((i) => i.oldInviteeId && links.has(i.oldInviteeId));
    const to = moved ? links.get(moved.newInviteeId!)! : null;
    const old = from ? links.get(from.oldInviteeId!)! : null;
    return {
      meeting: m,
      invitees: list,
      guestsByInvitee,
      noShows,
      hosts: hosts.map((h) => ({ id: h.userId, name: h.name, avatarUrl: h.avatarFileId ? fileUrl(h.avatarFileId) : h.avatarUrl })),
      eventType: etById.get(m.eventTypeId) ?? null,
      access,
      canEditEventType: et === "owner" || et === "edit",
      userNames,
      rescheduledTo: to && to.eventId !== m.id ? { eventId: to.eventId, start: to.start, end: to.end } : null,
      rescheduledFrom: old && old.eventId !== m.id ? { eventId: old.eventId, start: old.start, end: old.end } : null,
    } satisfies MeetingBundle;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The page

/** The viewer's personal event types (the "Event Types" filter), in Scheduling order. */
export async function eventTypeOptions(db: DbOrTx, actor: ActorCtx): Promise<EventTypeOption[]> {
  return db
    .select({ id: eventTypes.id, name: eventTypes.name, color: eventTypes.color })
    .from(eventTypes)
    .where(
      and(
        eq(eventTypes.organizationId, actor.orgId),
        eq(eventTypes.ownerUserId, actor.user.id),
        eq(eventTypes.scope, "personal"),
        eq(eventTypes.type, "standard"),
        isNull(eventTypes.deletedAt),
      ),
    )
    .orderBy(asc(eventTypes.position), asc(eventTypes.createdAt));
}

type DeepLink = { query: MeetingsQuery; pinned: RawMeeting | null; notFound: boolean };

/** Applies ?event= (see the file header): the meeting's tab, status and page, or a pinned meeting. */
async function resolveDeepLink(db: DbOrTx, ctx: ViewerContext, q: MeetingsQuery): Promise<DeepLink> {
  if (!q.event) return { query: q, pinned: null, notFound: false };
  const visible = visibleCondition(db, ctx.actor);
  const [m] = await db.select().from(scheduledEvents).where(and(eq(scheduledEvents.id, q.event), visible)).limit(1);
  if (!m) return { query: { ...q, event: null }, pinned: null, notFound: true };
  // Paging through the list keeps its place: only a deep link without a cursor is placed.
  if (q.after || q.before) return { query: q, pinned: null, notFound: false };
  let query = q;
  if (!q.tabExplicit) query = { ...query, tab: m.endAt.getTime() <= ctx.now.getTime() ? "past" : "upcoming" };
  if (!q.statusExplicit && m.status === "canceled") query = { ...query, status: ["active", "canceled"] };
  const where = and(visible, ...filterConditions(db, query, ctx))!;
  const [hit] = await db.select({ n: count() }).from(scheduledEvents).where(and(where, eq(scheduledEvents.id, m.id)));
  if (!hit?.n) return { query, pinned: m, notFound: false };
  const dir = sortDirOf(query.tab);
  const [before] = await db.select({ n: count() }).from(scheduledEvents).where(and(where, keysetCondition(dir, { s: m.startAt.toISOString(), i: m.id }, "before")));
  const position = Number(before?.n ?? 0);
  const page = Math.floor(position / PAGE_SIZE) + 1;
  if (page <= 1) return { query: { ...query, page: 1, after: null, before: null }, pinned: null, notFound: false };
  const [boundary] = await db
    .select({ id: scheduledEvents.id, startAt: scheduledEvents.startAt })
    .from(scheduledEvents)
    .where(where)
    .orderBy(...orderBy(dir))
    .offset((page - 1) * PAGE_SIZE - 1)
    .limit(1);
  if (!boundary) return { query: { ...query, page: 1, after: null, before: null }, pinned: null, notFound: false };
  return { query: { ...query, page, after: cursorOf(boundary), before: null }, pinned: null, notFound: false };
}

type Fetched = { rows: RawMeeting[]; hasNext: boolean; query: MeetingsQuery };

/** One page in list order: page 1, the page after a cursor, or the page before one (Previous). */
async function fetchRows(db: DbOrTx, where: SQL, q: MeetingsQuery): Promise<Fetched> {
  const dir = sortDirOf(q.tab);
  const firstPage = async (): Promise<Fetched> => {
    const found = await db.select().from(scheduledEvents).where(where).orderBy(...orderBy(dir)).limit(PAGE_SIZE + 1);
    return { rows: found.slice(0, PAGE_SIZE), hasNext: found.length > PAGE_SIZE, query: { ...q, page: 1, after: null, before: null } };
  };
  if (q.page <= 1) return firstPage();
  const after = readCursor(q.after);
  if (after) {
    const found = await db.select().from(scheduledEvents).where(and(where, keysetCondition(dir, after, "after"))).orderBy(...orderBy(dir)).limit(PAGE_SIZE + 1);
    // Nothing after the cursor any more (the list shrank): back to page 1.
    if (found.length === 0) return firstPage();
    return { rows: found.slice(0, PAGE_SIZE), hasNext: found.length > PAGE_SIZE, query: q };
  }
  const before = readCursor(q.before);
  if (before) {
    const back = await db.select().from(scheduledEvents).where(and(where, keysetCondition(dir, before, "before"))).orderBy(...orderBy(dir, true)).limit(PAGE_SIZE);
    // A full page before the cursor keeps the page numbers right; otherwise the list changed: start at page 1.
    if (back.length < PAGE_SIZE) return firstPage();
    const rows = back.reverse();
    const last = rows[rows.length - 1]!;
    const [more] = await db
      .select({ id: scheduledEvents.id })
      .from(scheduledEvents)
      .where(and(where, keysetCondition(dir, { s: last.startAt.toISOString(), i: last.id }, "after")))
      .limit(1);
    return { rows, hasNext: Boolean(more), query: q };
  }
  return firstPage();
}

/** Everything the Meetings page renders for a URL state (see the file header). */
export async function loadMeetingsPage(actor: ActorCtx, input: MeetingsQuery, opts: { db?: DbOrTx; now?: Date } = {}): Promise<MeetingsPageData> {
  const db = opts.db ?? (await getDb());
  const ctx = viewerContext(actor, opts.now ?? now());
  const today = todayIn(ctx);
  let query = input;
  if (query.tab === "range") query = { ...query, ...resolveRange(query, today) };
  const link = await resolveDeepLink(db, ctx, query);
  query = link.query;
  const where = and(visibleCondition(db, actor), ...filterConditions(db, query, ctx))!;
  const [{ rows, hasNext, query: paged }, totalRow, options] = await Promise.all([
    fetchRows(db, where, query),
    db.select({ n: count() }).from(scheduledEvents).where(where),
    eventTypeOptions(db, actor),
  ]);
  query = paged;
  const total = Number(totalRow[0]?.n ?? 0);
  const all = link.pinned && !rows.some((r) => r.id === link.pinned!.id) ? [...rows, link.pinned] : rows;
  const bundles = await loadBundles(db, ctx, all);
  const present: PresentContext = { now: ctx.now.getTime(), zone: ctx.zone, hour12: ctx.hour12, dateFormat: ctx.dateFormat, filterableEventTypeIds: new Set(options.map((o) => o.id)) };
  const views = new Map<string, MeetingView>(bundles.map((b) => [b.meeting.id, presentMeeting(b, present)]));

  const groups: MeetingDayGroup[] = [];
  for (const r of rows) {
    const v = views.get(r.id)!;
    const last = groups[groups.length - 1];
    if (last && last.dateKey === v.dateKey) last.meetings.push(v);
    else groups.push({ dateKey: v.dateKey, label: dayHeading(r.startAt, ctx.zone, ctx.dateFormat), meetings: [v] });
  }
  const from = rows.length ? (query.page - 1) * PAGE_SIZE + 1 : 0;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const pinned = link.pinned ? (views.get(link.pinned.id) ?? null) : null;
  return {
    query: { ...query, event: query.event && (views.has(query.event) ? query.event : null) },
    groups,
    total,
    from,
    to: rows.length ? from + rows.length - 1 : 0,
    pager: {
      page: query.page,
      prev: query.page > 1 && first ? { before: query.page - 1 > 1 ? cursorOf(first) : null, page: query.page - 1 } : null,
      next: hasNext && last ? { after: cursorOf(last), page: query.page + 1 } : null,
    },
    pinned: pinned && !rows.some((r) => r.id === pinned.id) ? pinned : null,
    eventNotFound: link.notFound,
    eventTypes: options,
    shareUrl: actor.user.slug ? absoluteUrl(`/${actor.user.slug}`) : null,
    serverNow: ctx.now.getTime(),
    timeZone: ctx.zone,
    timeZoneLabel: friendlyZoneName(ctx.zone),
    today,
    weekStart: ctx.weekStart,
    tab: query.tab,
  };
}
