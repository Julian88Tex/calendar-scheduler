// Event type reads (SPEC ET-03, ET-04, ET-14 to ET-29; ARCHITECTURE 17.1, 18.7). Server only.
// - getEventTypeEditorData / getNewEventTypeEditorData: everything the editor page renders (draft, schedules,
//   conferencing availability, writable calendars, host meeting limits, preview path).
// - listEventTypes: the actor's personal event types for the Scheduling page (event-types-list), with summaries.
// - getConferencingOptionsFor: the LocationEditor's connect prompts (the owner's own options only).
import "server-only";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { eventPersonasOf, personasOf } from "@/components/booking/lib/personas";
import { getDb, type DbOrTx } from "@/db";
import { availabilitySchedules, calendarConnections, calendars, eventTypeHosts, eventTypeQuestions, eventTypes, users } from "@/db/schema";
import type { WeeklyHours } from "@/db/types";
import { eventTypeAccess, isOrgAdmin, type ActorCtx } from "@/lib/authz";
import { getMeetingLimits, getScheduleDetailById, listSchedules, resolveEventTypeSchedule } from "@/lib/availability";
import { weeklySummary } from "@/lib/availability/intervals";
import { getDestinationCalendar } from "@/lib/calendars";
import { getConferencingOptions } from "@/lib/conferencing";
import { notFoundError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { absoluteUrl, appUrl } from "@/lib/url";
import { isoDateInZone } from "@/lib/time/format";
import { now } from "@/lib/time/now";
import { zoneOrUtc } from "@/lib/time/zones";
import { GOOGLE_MEET_REQUIREMENT, KIND_LABELS, uiKindOf } from "./constants";
import { draftOfRow, draftVersion, durationsOf, locationSummary, sortedLocations } from "./draft";
import { newEventTypeDefaults } from "./service";
import type { EditorCalendarOption, EditorConferencingOption, EditorScheduleOption, EventTypeEditorData, EventTypeListItem, ScheduleChoiceDraft } from "./types";

const PREVIEW_SLUG = "__preview__";

type Owner = EventTypeEditorData["owner"];

async function loadOwner(db: DbOrTx, userId: string): Promise<Owner> {
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      slug: users.slug,
      timezone: users.timezone,
      timeFormat: users.timeFormat,
      weekStart: users.weekStart,
      locale: users.locale,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw notFoundError("This person could not be found.");
  return {
    id: u.id,
    name: u.name ?? "",
    handle: u.slug ?? null,
    timezone: zoneOrUtc(u.timezone),
    timeFormat: u.timeFormat === "24h" ? "24h" : "12h",
    weekStart: u.weekStart === 1 ? 1 : 0,
    locale: u.locale ?? "en",
  };
}

async function editorSchedules(userId: string, db: DbOrTx): Promise<EditorScheduleOption[]> {
  const list = await listSchedules(userId, db);
  const out: EditorScheduleOption[] = [];
  for (const s of list) {
    const detail = await getScheduleDetailById(s.id, db);
    if (!detail) continue;
    out.push({
      id: s.id,
      name: s.name,
      isDefault: s.isDefault,
      content: { timezone: detail.timezone, weeklyHours: detail.weeklyHours, overrides: detail.overrides },
    });
  }
  return out;
}

async function writableCalendars(userId: string, db: DbOrTx): Promise<{ list: EditorCalendarOption[]; defaultName: string | null }> {
  const rows = await db
    .select({ id: calendars.id, name: calendars.name, accountEmail: calendarConnections.accountEmail })
    .from(calendars)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .where(
      and(
        eq(calendars.userId, userId),
        eq(calendarConnections.userId, userId),
        eq(calendars.canWrite, true),
        isNull(calendars.deletedAt),
        ne(calendarConnections.status, "disconnected"),
        inArray(calendarConnections.provider, ["google", "microsoft", "caldav"]),
      ),
    )
    .orderBy(asc(calendars.name));
  const [u] = await db.select({ dest: users.destinationCalendarId }).from(users).where(eq(users.id, userId)).limit(1);
  const defaultName = rows.find((r) => r.id === u?.dest)?.name ?? null;
  return { list: rows.map((r) => ({ id: r.id, name: r.name, accountEmail: r.accountEmail })), defaultName };
}

/**
 * Location availability for the editor (VID-07 and the conferencing contract): Google Meet needs a Google destination
 * calendar, so the destination is checked here as well, which keeps the message accurate before the conferencing
 * module reports it.
 */
async function locationOptions(userId: string, eventTypeId: string | null): Promise<Record<string, EditorConferencingOption>> {
  let options: Record<string, EditorConferencingOption> = {};
  try {
    options = { ...(await getConferencingOptions(userId)) };
  } catch (e) {
    log.warn("event_types.conferencing_options_failed", { error: e });
  }
  let googleMeet = false;
  try {
    const dest = await getDestinationCalendar(userId, eventTypeId ?? undefined);
    googleMeet = Boolean(dest?.supports.googleMeet);
  } catch (e) {
    log.warn("event_types.destination_lookup_failed", { error: e });
  }
  const google = options.google_conference;
  options.google_conference = googleMeet || google?.available
    ? { available: true }
    : { available: false, reason: GOOGLE_MEET_REQUIREMENT, connectUrl: google?.connectUrl ?? "/app/availability/calendar-settings" };
  return options;
}

async function invitationsAvailable(userId: string, eventTypeId: string | null): Promise<boolean> {
  try {
    const dest = await getDestinationCalendar(userId, eventTypeId ?? undefined);
    return Boolean(dest && (dest.provider === "google" || dest.provider === "microsoft") && dest.supports.invitations);
  } catch {
    return false;
  }
}

function linkPrefix(handle: string | null): string | null {
  if (!handle) return null;
  return `${new URL(appUrl()).host}/${handle}/`;
}

async function sharedEditorParts(ownerId: string, eventTypeId: string | null, db: DbOrTx) {
  const [schedules, conferencing, cals, limits, invitations] = await Promise.all([
    editorSchedules(ownerId, db),
    locationOptions(ownerId, eventTypeId),
    writableCalendars(ownerId, db),
    getMeetingLimits(ownerId, db).catch(() => ({ day: null, week: null, month: null })),
    invitationsAvailable(ownerId, eventTypeId),
  ]);
  return { schedules, conferencing, cals, limits, invitations };
}

/** The editor data of a saved event type, or null when the actor has no access to it (pages 404). */
export async function getEventTypeEditorData(actor: ActorCtx, eventTypeId: string, db?: DbOrTx): Promise<EventTypeEditorData | null> {
  const d = db ?? (await getDb());
  const access = await eventTypeAccess(actor, eventTypeId, d);
  if (!access) return null;
  const [row] = await d
    .select()
    .from(eventTypes)
    .where(and(eq(eventTypes.id, eventTypeId), isNull(eventTypes.deletedAt)))
    .limit(1);
  if (!row || row.type !== "standard") return null;
  const ownerId = row.ownerUserId ?? actor.user.id;
  const owner = await loadOwner(d, ownerId);
  const questions = await d.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, row.id)).orderBy(asc(eventTypeQuestions.position));
  let schedule: ScheduleChoiceDraft = { kind: "schedule", scheduleId: row.scheduleId };
  if (row.ownerUserId) {
    const state = await resolveEventTypeSchedule(row.id, row.ownerUserId, d);
    schedule =
      state.custom && state.schedule
        ? { kind: "custom", content: { timezone: state.schedule.timezone, weeklyHours: state.schedule.weeklyHours, overrides: state.schedule.overrides } }
        : { kind: "schedule", scheduleId: state.scheduleId };
  }
  const parts = await sharedEditorParts(ownerId, row.id, d);
  const kind = uiKindOf(row);
  const path = owner.handle && !row.teamId ? `/${owner.handle}/${row.slug}` : null;
  const personal = Boolean(row.ownerUserId && !row.teamId && row.scope === "personal");
  const ownerPrefs = personal ? (await d.select({ preferences: users.preferences }).from(users).where(eq(users.id, row.ownerUserId!)).limit(1))[0]?.preferences : null;
  const draft = draftOfRow(row, questions, schedule, personal ? eventPersonasOf(row.metadata, row.slug, ownerPrefs) : null);
  return {
    mode: "edit",
    eventTypeId: row.id,
    version: draftVersion(draft),
    kind,
    kindLabel: KIND_LABELS[kind],
    access,
    canDelete: access === "owner" || isOrgAdmin(actor),
    active: row.active,
    draft,
    owner,
    linkPrefix: row.teamId ? null : linkPrefix(owner.handle),
    publicUrl: path ? absoluteUrl(path) : null,
    previewPath: path ? `${path}?preview=1` : null,
    schedules: parts.schedules,
    scheduleEditable: Boolean(row.ownerUserId),
    conferencing: parts.conferencing,
    calendars: parts.cals.list,
    defaultCalendarName: parts.cals.defaultName,
    invitationsAvailable: parts.invitations,
    hostLimits: parts.limits,
    today: isoDateInZone(now(), owner.timezone),
    personas: personal ? personasOf(ownerPrefs) : null,
  };
}

/** The editor data of a new one-on-one event type with the ET-33 defaults (created on first save). */
export async function getNewEventTypeEditorData(actor: ActorCtx, db?: DbOrTx): Promise<EventTypeEditorData> {
  const d = db ?? (await getDb());
  const owner = await loadOwner(d, actor.user.id);
  const [draft, parts] = await Promise.all([newEventTypeDefaults(d, actor), sharedEditorParts(actor.user.id, null, d)]);
  const [ownerRow] = await d.select({ preferences: users.preferences }).from(users).where(eq(users.id, actor.user.id)).limit(1);
  const personas = personasOf(ownerRow?.preferences);
  // A new event type starts out shown to every persona under its real name.
  draft.personas = Object.fromEntries(personas.map((p) => [p.id, { name: "", description: "" }]));
  if (draft.schedule.kind === "schedule" && !draft.schedule.scheduleId) {
    draft.schedule = { kind: "schedule", scheduleId: parts.schedules.find((s) => s.isDefault)?.id ?? parts.schedules[0]?.id ?? null };
  }
  return {
    mode: "create",
    eventTypeId: null,
    version: null,
    kind: "one_on_one",
    kindLabel: KIND_LABELS.one_on_one,
    access: "owner",
    canDelete: false,
    active: true,
    draft,
    owner,
    linkPrefix: linkPrefix(owner.handle),
    publicUrl: null,
    previewPath: owner.handle ? `/${owner.handle}/${PREVIEW_SLUG}?preview=1` : null,
    schedules: parts.schedules,
    scheduleEditable: true,
    conferencing: parts.conferencing,
    calendars: parts.cals.list,
    defaultCalendarName: parts.cals.defaultName,
    invitationsAvailable: parts.invitations,
    hostLimits: parts.limits,
    today: isoDateInZone(now(), owner.timezone),
    personas,
  };
}

/** The LocationEditor's conferencing availability for `userId` (the actor's own, or any member's for org admins). */
export async function getConferencingOptionsFor(actor: ActorCtx, userId: string): Promise<Record<string, EditorConferencingOption>> {
  if (userId !== actor.user.id && !isOrgAdmin(actor)) return locationOptions(actor.user.id, null);
  return locationOptions(userId, null);
}

/**
 * The actor's personal event types for the Scheduling page (ET-03, ET-04), ordered by position: durations, location
 * summary, availability summary ("Weekdays, 9 am - 5 pm" / "Hours vary"), public link and access.
 */
export async function listEventTypes(actor: ActorCtx, db?: DbOrTx): Promise<EventTypeListItem[]> {
  const d = db ?? (await getDb());
  const rows = await d
    .select()
    .from(eventTypes)
    .where(
      and(
        eq(eventTypes.ownerUserId, actor.user.id),
        isNull(eventTypes.teamId),
        eq(eventTypes.scope, "personal"),
        eq(eventTypes.type, "standard"),
        isNull(eventTypes.deletedAt),
      ),
    )
    .orderBy(asc(eventTypes.position), asc(eventTypes.createdAt));
  if (!rows.length) return [];
  const owner = await loadOwner(d, actor.user.id);
  const hour12 = owner.timeFormat !== "24h";
  const [prefsRow] = await d.select({ preferences: users.preferences }).from(users).where(eq(users.id, actor.user.id)).limit(1);
  const hostRows = await d
    .select({ eventTypeId: eventTypeHosts.eventTypeId, scheduleId: eventTypeHosts.scheduleId })
    .from(eventTypeHosts)
    .where(and(inArray(eventTypeHosts.eventTypeId, rows.map((r) => r.id)), eq(eventTypeHosts.userId, actor.user.id)));
  const schedules = await d
    .select({
      id: availabilitySchedules.id,
      isDefault: availabilitySchedules.isDefault,
      eventTypeId: availabilitySchedules.eventTypeId,
      singleUseLinkId: availabilitySchedules.singleUseLinkId,
      weeklyHours: availabilitySchedules.weeklyHours,
    })
    .from(availabilitySchedules)
    .where(and(eq(availabilitySchedules.userId, actor.user.id), isNull(availabilitySchedules.deletedAt), isNull(availabilitySchedules.singleUseLinkId)));
  const byId = new Map(schedules.map((s) => [s.id, s]));
  const fallback = schedules.find((s) => s.isDefault && !s.eventTypeId) ?? schedules.find((s) => !s.eventTypeId) ?? null;
  return rows.map((r) => {
    const hostSchedule = hostRows.find((h) => h.eventTypeId === r.id)?.scheduleId ?? null;
    const usable = (id: string | null) => {
      const s = id ? byId.get(id) : undefined;
      return s && (!s.eventTypeId || s.eventTypeId === r.id) ? s : null;
    };
    const schedule = usable(hostSchedule) ?? usable(r.scheduleId) ?? fallback;
    const weekly = normalizeWeekly(schedule?.weeklyHours);
    const kind = uiKindOf(r);
    const locations = sortedLocations(r.locations);
    const path = owner.handle ? `/${owner.handle}/${r.slug}` : null;
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      color: r.color,
      kind,
      kindLabel: KIND_LABELS[kind],
      active: r.active,
      secret: r.secret,
      position: r.position,
      durations: durationsOf(r),
      locationKinds: locations.map((l) => l.kind),
      locationSummary: locationSummary(locations),
      internalNote: r.internalNote,
      scheduleId: schedule?.id ?? null,
      customSchedule: Boolean(schedule?.eventTypeId),
      availabilitySummary: schedule ? weeklySummary(weekly, hour12, owner.weekStart) : "No schedule",
      publicPath: path,
      publicUrl: path ? absoluteUrl(path) : null,
      personaIds: Object.keys(eventPersonasOf(r.metadata, r.slug, prefsRow?.preferences ?? null)),
      access: "owner" as const,
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

function normalizeWeekly(raw: unknown): WeeklyHours {
  const days = Array.isArray(raw) ? raw : [];
  return Array.from({ length: 7 }, (_, i) =>
    (Array.isArray(days[i]) ? (days[i] as { start: number; end: number }[]) : []).filter(
      (x) => x && Number.isInteger(x.start) && Number.isInteger(x.end) && x.end > x.start,
    ),
  ) as WeeklyHours;
}
