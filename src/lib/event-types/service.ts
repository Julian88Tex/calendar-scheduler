// Event type services (SPEC ET-01, ET-09 to ET-26, ET-33, AV-11, CAL-20, VID-01 to VID-07, GEN-17; ARCHITECTURE
// 5.4.5 rules and 18.7 cross-tenant checks). Server only. Every function takes the actor and authorizes itself, so the
// server actions stay thin and the same code is testable without Next.
//
// - saveEventType: the editor's whole-form "Save changes" (ET-14), atomic: creates a new one-on-one type with the ET-33
//   defaults on first save, or updates an existing one (kind immutable, version checked, slug unique per profile,
//   questions upserted by id, schedule choice through the availability service).
// - duplicateEventType (ET-11), deleteEventType (ET-12, soft delete, audited), setEventTypeActive (ET-09),
//   setEventTypeSecret (ET-10), setInternalNote (ET-13), reorderEventTypes (ET-07), checkSlugAvailability (ET-23).
// - Each mutation publishes event_type.created / updated / deleted in its transaction.
import "server-only";
import { and, asc, eq, gt, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { advisoryXactLock, isUniqueViolation, withTx } from "@/db/helpers";
import {
  availabilitySchedules,
  eventTypeCoupons,
  eventTypeHostPools,
  eventTypeHosts,
  eventTypeQuestions,
  eventTypes,
  singleUseLinks,
  users,
  workflowEventTypes,
  workflows,
} from "@/db/schema";
import type { LocationConfig, NotificationTemplates } from "@/db/types";
import { rotatedEventColor } from "@/components/ui/event-colors";
import { audit } from "@/lib/audit";
import {
  assertAccess,
  assertCalendarOwnedBy,
  assertLocationConnectionsOwnedBy,
  eventTypeAccess,
  eventTypeAccessAtLeast,
  isOrgAdmin,
  type ActorCtx,
} from "@/lib/authz";
import {
  createCustomSchedule,
  ensureDefaultSchedule,
  getScheduleContent,
  lockUserSchedules,
  resolveEventTypeSchedule,
  setEventTypeSchedule,
} from "@/lib/availability";
import { sortIntervals } from "@/lib/availability/intervals";
import { AppError, notFoundError } from "@/lib/errors";
import { publishEvent } from "@/lib/events";
import { richTextToPlain, sanitizeRichText } from "@/lib/html";
import { newId, shortCode } from "@/lib/ids";
import { slugify } from "@/lib/slugs";
import { now } from "@/lib/time/now";
import { copyEventTypeReminders } from "@/lib/workflows";
import { DEFAULT_NAMES, DESCRIPTION_MAX, MESSAGES, SUPPORTED_LOCALES } from "./constants";
import { eventPersonasOf, type EventPersonas } from "@/components/booking/lib/personas";
import { canonicalJson, copyName, copySlugCandidates, dedupeSlug, defaultDraft, draftOfRow, draftVersion, durationColumns } from "./draft";
import { isHttpUrl, normalizeLocations, validateDraft, zEventSlug, type SaveEventTypeInput } from "./schemas";
import type { EventTypeDraft, SaveEventTypeResult, ScheduleChoiceDraft } from "./types";

type EventTypeRow = typeof eventTypes.$inferSelect;
type NewEventTypeRow = typeof eventTypes.$inferInsert;

const NOT_FOUND = "This event type could not be found.";
const CANT_EDIT = "You can view this event type but not edit it.";
const VERSION_CONFLICT = "This event type was changed in another window. Refresh the page to see the latest version.";

function eventActor(actor: ActorCtx) {
  return { type: "user" as const, userId: actor.user.id, ...(actor.user.name ? { name: actor.user.name } : {}) };
}

async function loadRow(db: DbOrTx, id: string, opts: { forUpdate?: boolean } = {}): Promise<EventTypeRow> {
  const q = db
    .select()
    .from(eventTypes)
    .where(and(eq(eventTypes.id, id), isNull(eventTypes.deletedAt)))
    .limit(1);
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  if (!row || row.type !== "standard") throw notFoundError(NOT_FOUND);
  return row;
}

/**
 * Lock order (shared with the availability module, which takes the user's schedule lock and then event type rows):
 * the owner's schedule lock first, then the event type row (FOR UPDATE), then the profile's slug lock.
 */
async function lockForWrite(tx: DbOrTx, id: string): Promise<EventTypeRow> {
  const peek = await loadRow(tx, id);
  if (peek.ownerUserId) await lockUserSchedules(tx, peek.ownerUserId);
  return loadRow(tx, id, { forUpdate: true });
}

/** Access of the actor to a live standard event type (throws not_found when it does not exist for them). */
async function requireAccess(actor: ActorCtx, id: string, db: DbOrTx) {
  const access = await eventTypeAccess(actor, id, db);
  if (!access) throw notFoundError(NOT_FOUND);
  return access;
}

async function requireEdit(actor: ActorCtx, id: string, db: DbOrTx) {
  const access = await requireAccess(actor, id, db);
  if (!eventTypeAccessAtLeast(access, "edit")) throw new AppError("forbidden", CANT_EDIT);
  return access;
}

// Slugs ---------------------------------------------------------------------------------------------------------

/** The rows sharing a slug namespace with an event type (ET-23: unique per profile among live types). */
function slugScope(row: Pick<EventTypeRow, "ownerUserId" | "teamId" | "scope">) {
  if (row.teamId) return and(eq(eventTypes.teamId, row.teamId), isNull(eventTypes.deletedAt));
  if (row.scope === "personal" && row.ownerUserId) {
    return and(
      eq(eventTypes.ownerUserId, row.ownerUserId),
      isNull(eventTypes.teamId),
      eq(eventTypes.scope, "personal"),
      eq(eventTypes.type, "standard"),
      isNull(eventTypes.deletedAt),
    );
  }
  return null; // shared types live under /d/{code}/{slug}: the code keeps their links unique
}

const slugLockKey = (row: Pick<EventTypeRow, "ownerUserId" | "teamId">) => `event_types:slugs:${row.teamId ?? row.ownerUserId ?? "none"}`;

async function takenSlugs(db: DbOrTx, row: Pick<EventTypeRow, "ownerUserId" | "teamId" | "scope">, exceptId?: string): Promise<Set<string>> {
  const scope = slugScope(row);
  if (!scope) return new Set();
  const rows = await db
    .select({ slug: eventTypes.slug })
    .from(eventTypes)
    .where(exceptId ? and(scope, ne(eventTypes.id, exceptId)) : scope);
  return new Set(rows.map((r) => r.slug));
}

const slugTakenError = () => new AppError("conflict", MESSAGES.slugTaken, { fieldErrors: { slug: [MESSAGES.slugTaken] } });

/** ET-23 live uniqueness check for the editor's Event link field. */
export async function checkSlugAvailability(
  db: DbOrTx,
  actor: ActorCtx,
  input: { slug: string; eventTypeId: string | null },
): Promise<{ slug: string; available: boolean; message: string | null }> {
  const parsed = zEventSlug.safeParse(input.slug);
  if (!parsed.success) return { slug: input.slug.trim().toLowerCase(), available: false, message: MESSAGES.slugInvalid };
  const slug = parsed.data;
  let scopeRow: Pick<EventTypeRow, "ownerUserId" | "teamId" | "scope"> = { ownerUserId: actor.user.id, teamId: null, scope: "personal" };
  if (input.eventTypeId) {
    await requireAccess(actor, input.eventTypeId, db);
    scopeRow = await loadRow(db, input.eventTypeId);
  }
  const taken = await takenSlugs(db, scopeRow, input.eventTypeId ?? undefined);
  const available = !taken.has(slug);
  return { slug, available, message: available ? null : MESSAGES.slugTaken };
}

// Draft to columns ----------------------------------------------------------------------------------------------

function descriptionColumns(html: string): { descriptionHtml: string | null; descriptionPlain: string | null } {
  const clean = sanitizeRichText(html);
  const plain = clean ? richTextToPlain(clean).trim() : "";
  if (plain.length > DESCRIPTION_MAX) {
    throw new AppError("validation", MESSAGES.descriptionTooLong, { fieldErrors: { descriptionHtml: [MESSAGES.descriptionTooLong] } });
  }
  return plain || /<a\s/i.test(clean) ? { descriptionHtml: clean, descriptionPlain: plain || null } : { descriptionHtml: null, descriptionPlain: null };
}

/** Rich text template bodies (NT-08) are stored sanitized like the description; plain text fields are kept as typed. */
function templateColumns(t: NotificationTemplates): NotificationTemplates {
  const out: NotificationTemplates = { ...t };
  for (const key of ["confirmationBody", "invitationDescription", "cancellationBody"] as const) {
    const value = out[key];
    if (value === undefined) continue;
    const clean = /<[a-z!/]/i.test(value) ? sanitizeRichText(value) : value;
    if (clean.trim() && richTextToPlain(clean).trim()) out[key] = clean;
    else delete out[key];
  }
  return out;
}

/** The event_types columns a draft writes (slug, schedule and questions are handled by the caller). */
function columnsOfDraft(draft: EventTypeDraft, kind: "solo" | "group"): Omit<NewEventTypeRow, "organizationId" | "name" | "slug"> & { name: string } {
  const { durationMinutes, durationOptions } = durationColumns(draft.durations);
  const fixed = draft.dateRange.type === "fixed";
  return {
    name: draft.name,
    color: draft.color,
    ...descriptionColumns(draft.descriptionHtml),
    durationMinutes,
    durationOptions: kind === "group" ? null : durationOptions,
    locations: normalizeLocations(draft.locations),
    dateRangeType: draft.dateRange.type,
    dateRangeDays: draft.dateRange.days,
    dateRangeMode: draft.dateRange.mode,
    dateRangeStart: fixed ? draft.dateRange.start : null,
    dateRangeEnd: fixed ? draft.dateRange.end : null,
    minimumNoticeMinutes: draft.minimumNoticeMinutes,
    bufferBeforeMinutes: draft.bufferBeforeMinutes,
    bufferAfterMinutes: draft.bufferAfterMinutes,
    slotIncrementMinutes: draft.slotIncrementMinutes,
    limitPerDay: draft.limitPerDay,
    limitPerWeek: draft.limitPerWeek,
    limitPerMonth: draft.limitPerMonth,
    timeZoneDisplay: draft.timeZoneDisplay,
    lockedTimeZone: draft.timeZoneDisplay === "locked" ? draft.lockedTimeZone : null,
    destinationCalendarId: draft.destinationCalendarId,
    nameFormat: draft.nameFormat,
    allowGuests: kind === "group" ? false : draft.allowGuests,
    notificationType: kind === "group" ? "email_confirmation" : draft.notificationType,
    notificationTemplates: templateColumns(draft.notificationTemplates),
    includeCancelRescheduleLinks: draft.includeCancelRescheduleLinks,
    includeAnswersInNotifications: draft.includeAnswersInNotifications,
    cancellationPolicy: draft.cancellationPolicy || null,
    afterBooking: draft.afterBooking,
    // A redirect URL left over from switching back to the confirmation page is kept only when it is valid.
    redirectUrl: draft.afterBooking === "redirect" || isHttpUrl(draft.redirectUrl) ? draft.redirectUrl || null : null,
    redirectPassDetails: draft.redirectPassDetails,
    scheduleAnotherEnabled: draft.scheduleAnotherEnabled,
    scheduleAnotherLabel: draft.scheduleAnotherLabel,
    confirmationLinks: draft.confirmationLinks,
    secret: draft.secret,
    internalNote: draft.internalNote || null,
  };
}

async function syncQuestions(tx: DbOrTx, eventTypeId: string, questions: EventTypeDraft["questions"]): Promise<void> {
  const existing = await tx.select({ id: eventTypeQuestions.id }).from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, eventTypeId));
  const existingIds = new Set(existing.map((r) => r.id));
  const kept: string[] = [];
  for (const [position, q] of questions.entries()) {
    const values = {
      position,
      label: q.label,
      type: q.type,
      required: q.required,
      enabled: q.enabled,
      answerChoices: q.answerChoices,
      includeOther: q.includeOther,
    };
    if (existingIds.has(q.id)) {
      await tx.update(eventTypeQuestions).set({ ...values, updatedAt: now() }).where(eq(eventTypeQuestions.id, q.id));
      kept.push(q.id);
    } else {
      // Ids of new questions are generated here: a client id could name another event type's question.
      const [row] = await tx.insert(eventTypeQuestions).values({ eventTypeId, ...values }).returning({ id: eventTypeQuestions.id });
      if (row) kept.push(row.id);
    }
  }
  const stale = kept.length
    ? and(eq(eventTypeQuestions.eventTypeId, eventTypeId), notInArray(eventTypeQuestions.id, kept))
    : eq(eventTypeQuestions.eventTypeId, eventTypeId);
  await tx.delete(eventTypeQuestions).where(stale);
}

function sameContent(a: ScheduleChoiceDraft & { kind: "custom" }, b: { timezone: string; weeklyHours: unknown; overrides: unknown } | null): boolean {
  if (!b) return false;
  const norm = (c: { timezone: string; weeklyHours: unknown; overrides: unknown }) => ({
    timezone: c.timezone,
    weeklyHours: (c.weeklyHours as { start: number; end: number }[][]).map((d) => sortIntervals(d)),
    overrides: [...(c.overrides as { date: string; intervals: { start: number; end: number }[] }[])]
      .map((o) => ({ date: o.date, intervals: sortIntervals(o.intervals) }))
      .sort((x, y) => x.date.localeCompare(y.date)),
  });
  return canonicalJson(norm(a.content)) === canonicalJson(norm(b));
}

/** Applies the availability choice through the availability service (AV-11; assertScheduleUsableBy inside, 403). */
async function applyScheduleChoice(tx: DbOrTx, eventTypeId: string, ownerUserId: string, choice: ScheduleChoiceDraft, created: boolean): Promise<void> {
  if (!created) {
    const current = await resolveEventTypeSchedule(eventTypeId, ownerUserId, tx);
    if (choice.kind === "schedule" && !current.custom && choice.scheduleId !== null && choice.scheduleId === current.scheduleId) return;
    if (choice.kind === "custom" && current.custom && current.schedule && sameContent(choice, current.schedule)) return;
  }
  let resolved = choice;
  if (choice.kind === "schedule" && choice.scheduleId === null) {
    // New event types store an explicit schedule id (the owner's default schedule).
    resolved = { kind: "schedule", scheduleId: (await ensureDefaultSchedule(tx, ownerUserId)).id };
  }
  await setEventTypeSchedule(tx, { eventTypeId, userId: ownerUserId, scope: "event", choice: resolved });
}

/** Cross-tenant checks of the references a draft stores (ARCHITECTURE 18.7): 403 for foreign ids. */
async function assertDraftReferences(tx: DbOrTx, row: Pick<EventTypeRow, "id" | "ownerUserId" | "destinationCalendarId">, draft: EventTypeDraft, hostIds: string[]) {
  if (draft.destinationCalendarId) {
    const owner = row.ownerUserId;
    if (!owner) throw new AppError("forbidden", "Choose a calendar you can add events to.");
    await assertCalendarOwnedBy(tx, draft.destinationCalendarId, owner);
  }
  await assertLocationConnectionsOwnedBy(tx, draft.locations, hostIds);
}

/** The stored event type as the editor draft (questions and the resolved schedule choice included). */
async function currentDraft(db: DbOrTx, row: EventTypeRow): Promise<EventTypeDraft> {
  const questions = await db.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, row.id)).orderBy(asc(eventTypeQuestions.position));
  let schedule: ScheduleChoiceDraft = { kind: "schedule", scheduleId: row.scheduleId };
  if (row.ownerUserId) {
    const state = await resolveEventTypeSchedule(row.id, row.ownerUserId, db);
    schedule =
      state.custom && state.schedule
        ? { kind: "custom", content: { timezone: state.schedule.timezone, weeklyHours: state.schedule.weeklyHours, overrides: state.schedule.overrides } }
        : { kind: "schedule", scheduleId: state.scheduleId };
  }
  return draftOfRow(row, questions, schedule, await personasOfRow(db, row));
}

/** The persona list of a personal event type (built-in personas from its owner when never saved), else null. */
export async function personasOfRow(db: DbOrTx, row: EventTypeRow): Promise<EventPersonas | null> {
  if (!row.ownerUserId || row.teamId || row.scope !== "personal") return null;
  const [u] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, row.ownerUserId)).limit(1);
  return eventPersonasOf(row.metadata, row.slug, u?.preferences ?? null);
}

/** The editor version (draftVersion) of the stored event type. */
async function versionOf(db: DbOrTx, id: string): Promise<string> {
  const [row] = await db.select().from(eventTypes).where(eq(eventTypes.id, id)).limit(1);
  if (!row) throw notFoundError(NOT_FOUND);
  return draftVersion(await currentDraft(db, row));
}

/** The saved event type as an editor draft (returned by saveEventType so the editor adopts server ids). */
async function savedResult(tx: DbOrTx, id: string, created: boolean): Promise<SaveEventTypeResult> {
  const [row] = await tx.select().from(eventTypes).where(eq(eventTypes.id, id)).limit(1);
  if (!row) throw notFoundError(NOT_FOUND);
  const draft = await currentDraft(tx, row);
  return { id, slug: row.slug, version: draftVersion(draft), created, draft };
}

function validationFailure(fieldErrors: Record<string, string[]>): AppError {
  return new AppError("validation", { fieldErrors });
}

// Create -------------------------------------------------------------------------------------------------------

/** Locale of new event types (ET-33): the owner's locale when supported, else English. */
function localeFor(locale: string | null | undefined): string {
  const base = (locale ?? "en").toLowerCase().split(/[-_]/)[0] ?? "en";
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? base : "en";
}

/** The ET-33 defaults for a new event type of the actor (the editor's starting draft). */
export async function newEventTypeDefaults(db: DbOrTx, actor: ActorCtx): Promise<EventTypeDraft> {
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(eventTypes)
    .where(and(eq(eventTypes.ownerUserId, actor.user.id), isNull(eventTypes.teamId), eq(eventTypes.type, "standard")));
  const [user] = await db.select({ defaultLocation: users.defaultLocation }).from(users).where(eq(users.id, actor.user.id)).limit(1);
  const [schedule] = await db
    .select({ id: availabilitySchedules.id })
    .from(availabilitySchedules)
    .where(
      and(
        eq(availabilitySchedules.userId, actor.user.id),
        eq(availabilitySchedules.isDefault, true),
        isNull(availabilitySchedules.eventTypeId),
        isNull(availabilitySchedules.singleUseLinkId),
        isNull(availabilitySchedules.deletedAt),
      ),
    )
    .limit(1);
  return defaultDraft({
    name: DEFAULT_NAMES.one_on_one,
    color: rotatedEventColor(Number(count?.n ?? 0)),
    scheduleId: schedule?.id ?? null,
    questionId: newId(),
    defaultLocation: user?.defaultLocation ?? null,
    locationId: newId(),
  });
}

async function createEventType(db: DB | DbOrTx, actor: ActorCtx, raw: unknown): Promise<SaveEventTypeResult> {
  const checked = validateDraft(raw, "solo");
  if (!checked.ok) throw validationFailure(checked.fieldErrors);
  const draft = checked.draft;
  const ownerUserId = actor.user.id;
  return withTx(db as DB, async (tx) => {
    const scopeRow = { ownerUserId, teamId: null, scope: "personal" as const };
    await lockUserSchedules(tx, ownerUserId);
    await advisoryXactLock(tx, slugLockKey(scopeRow));
    const taken = await takenSlugs(tx, scopeRow);
    let slug: string;
    if (draft.slug) {
      if (taken.has(draft.slug)) throw slugTakenError();
      slug = draft.slug;
    } else {
      slug = dedupeSlug(slugify(draft.name) || "meeting", taken);
    }
    await assertDraftReferences(tx, { id: "", ownerUserId, destinationCalendarId: null }, draft, [ownerUserId]);
    const [last] = await tx
      .select({ max: sql<number | null>`max(${eventTypes.position})` })
      .from(eventTypes)
      .where(and(eq(eventTypes.ownerUserId, ownerUserId), isNull(eventTypes.teamId), eq(eventTypes.scope, "personal"), isNull(eventTypes.deletedAt)));
    let row: EventTypeRow | undefined;
    try {
      [row] = await tx
        .insert(eventTypes)
        .values({
          ...columnsOfDraft(draft, "solo"),
          ...(draft.personas ? { metadata: { personas: draft.personas } } : {}),
          organizationId: actor.orgId,
          ownerUserId,
          teamId: null,
          scope: "personal",
          type: "standard",
          bookingMethod: "instant",
          kind: "solo",
          poolingType: null,
          slug,
          position: last?.max === null || last?.max === undefined ? 0 : Number(last.max) + 1,
          active: true,
          locale: localeFor(actor.user.locale),
          maxInvitees: 1,
          availabilitySetting: "host",
          createdByUserId: actor.user.id,
        })
        .returning();
    } catch (e) {
      if (isUniqueViolation(e)) throw slugTakenError();
      throw e;
    }
    if (!row) throw new Error("createEventType: insert returned no row");
    // ARCHITECTURE 5.4.5: personal solo types have exactly one host row, the owner.
    await tx.insert(eventTypeHosts).values({ eventTypeId: row.id, userId: ownerUserId, poolId: null, position: 0 });
    await syncQuestions(tx, row.id, draft.questions);
    await applyScheduleChoice(tx, row.id, ownerUserId, draft.schedule, true);
    await publishEvent(tx, "event_type.created", { eventTypeId: row.id }, { organizationId: actor.orgId, actor: eventActor(actor) });
    return savedResult(tx, row.id, true);
  });
}

// Update -------------------------------------------------------------------------------------------------------

async function updateEventType(db: DB | DbOrTx, actor: ActorCtx, id: string, version: string | null, raw: unknown): Promise<SaveEventTypeResult> {
  return withTx(db as DB, async (tx) => {
    await requireEdit(actor, id, tx);
    const row = await lockForWrite(tx, id);
    // Only changes to what the editor shows count as conflicts (draftVersion); an updated_at version is still honored.
    if (version && version !== row.updatedAt.toISOString() && version !== draftVersion(await currentDraft(tx, row))) {
      throw new AppError("conflict", VERSION_CONFLICT);
    }
    const checked = validateDraft(raw, row.kind);
    if (!checked.ok) throw validationFailure(checked.fieldErrors);
    const draft = checked.draft;
    if (!draft.slug) throw validationFailure({ slug: [MESSAGES.slugInvalid] });

    await advisoryXactLock(tx, slugLockKey(row));
    if (draft.slug !== row.slug && (await takenSlugs(tx, row, row.id)).has(draft.slug)) throw slugTakenError();

    const hosts = await tx.select({ userId: eventTypeHosts.userId }).from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, id));
    const hostIds = [...new Set([...(row.ownerUserId ? [row.ownerUserId] : []), ...hosts.map((h) => h.userId)])];
    if (draft.destinationCalendarId !== row.destinationCalendarId || draft.locations.some((l) => l.connectionId)) {
      await assertDraftReferences(tx, row, draft, hostIds);
    }

    const columns = columnsOfDraft(draft, row.kind);
    try {
      await tx
        .update(eventTypes)
        .set({
          ...columns,
          ...(draft.personas && !row.teamId ? { metadata: { ...(row.metadata ?? {}), personas: draft.personas } } : {}),
          slug: draft.slug,
          updatedAt: now(),
        })
        .where(eq(eventTypes.id, id));
    } catch (e) {
      if (isUniqueViolation(e)) throw slugTakenError();
      throw e;
    }
    await syncQuestions(tx, id, draft.questions);
    if (row.ownerUserId) await applyScheduleChoice(tx, id, row.ownerUserId, draft.schedule, false);
    if (draft.slug !== row.slug) {
      await audit(
        {
          action: "event_type.slug_changed",
          namespace: "event_types",
          targetType: "event_type",
          targetId: id,
          details: { from: row.slug, to: draft.slug },
          actor,
        },
        tx,
      );
    }
    await publishEvent(tx, "event_type.updated", { eventTypeId: id }, { organizationId: row.organizationId, actor: eventActor(actor) });
    return savedResult(tx, id, false);
  });
}

/** ET-14 "Save changes": creates (id null) or updates the whole event type atomically. */
export async function saveEventType(db: DB | DbOrTx, actor: ActorCtx, input: SaveEventTypeInput): Promise<SaveEventTypeResult> {
  if (!input.id) return createEventType(db, actor, input.draft);
  return updateEventType(db, actor, input.id, input.version, input.draft);
}

// Event-level actions ----------------------------------------------------------------------------------------------

async function touch(tx: DbOrTx, actor: ActorCtx, row: EventTypeRow, set: Partial<NewEventTypeRow>): Promise<string> {
  await tx.update(eventTypes).set({ ...set, updatedAt: now() }).where(eq(eventTypes.id, row.id));
  await publishEvent(tx, "event_type.updated", { eventTypeId: row.id }, { organizationId: row.organizationId, actor: eventActor(actor) });
  return versionOf(tx, row.id);
}

/** ET-09 On/Off. */
export async function setEventTypeActive(db: DB | DbOrTx, actor: ActorCtx, id: string, active: boolean): Promise<{ version: string }> {
  return withTx(db as DB, async (tx) => {
    await requireEdit(actor, id, tx);
    const row = await loadRow(tx, id, { forUpdate: true });
    if (row.active === active) return { version: await versionOf(tx, row.id) };
    return { version: await touch(tx, actor, row, { active }) };
  });
}

/** ET-10 Make secret / Make public. */
export async function setEventTypeSecret(db: DB | DbOrTx, actor: ActorCtx, id: string, secret: boolean): Promise<{ version: string }> {
  return withTx(db as DB, async (tx) => {
    await requireEdit(actor, id, tx);
    const row = await loadRow(tx, id, { forUpdate: true });
    if (row.secret === secret) return { version: await versionOf(tx, row.id) };
    return { version: await touch(tx, actor, row, { secret }) };
  });
}

/** ET-13 internal note (empty clears it). */
export async function setInternalNote(db: DB | DbOrTx, actor: ActorCtx, id: string, note: string): Promise<{ version: string; note: string | null }> {
  return withTx(db as DB, async (tx) => {
    await requireEdit(actor, id, tx);
    const row = await loadRow(tx, id, { forUpdate: true });
    const value = note.trim() || null;
    if ((row.internalNote ?? null) === value) return { version: await versionOf(tx, row.id), note: value };
    return { version: await touch(tx, actor, row, { internalNote: value }), note: value };
  });
}

/** ET-28 invitee language (kept for API parity; English only per docs/SCOPE.md, no editor UI). */
export async function setEventTypeLocale(db: DB | DbOrTx, actor: ActorCtx, id: string, locale: string): Promise<{ version: string }> {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) throw new AppError("validation", "Choose a supported language.");
  return withTx(db as DB, async (tx) => {
    await requireEdit(actor, id, tx);
    const row = await loadRow(tx, id, { forUpdate: true });
    if (row.locale === locale) return { version: await versionOf(tx, row.id) };
    return { version: await touch(tx, actor, row, { locale }) };
  });
}

/**
 * ET-07 reorder: `ids` in their new order, all from one section (the same owner's personal types, or one team's).
 * Positions become 0..n-1; types of the section that are not listed keep their relative order after them.
 */
export async function reorderEventTypes(db: DB | DbOrTx, actor: ActorCtx, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new AppError("validation", "Each event type can appear only once.");
  await withTx(db as DB, async (tx) => {
    const rows = await tx
      .select({ id: eventTypes.id, ownerUserId: eventTypes.ownerUserId, teamId: eventTypes.teamId, scope: eventTypes.scope, type: eventTypes.type, deletedAt: eventTypes.deletedAt })
      .from(eventTypes)
      .where(inArray(eventTypes.id, unique));
    if (rows.length !== unique.length || rows.some((r) => r.deletedAt || r.type !== "standard")) throw notFoundError(NOT_FOUND);
    const first = rows[0]!;
    const sameSection = rows.every((r) => r.teamId === first.teamId && r.scope === first.scope && (first.teamId || r.ownerUserId === first.ownerUserId));
    if (!sameSection) throw new AppError("validation", "Event types can only be reordered within their section.");
    for (const id of unique) await requireEdit(actor, id, tx);
    const scope = slugScope(first) ?? and(eq(eventTypes.ownerUserId, first.ownerUserId!), eq(eventTypes.scope, first.scope), isNull(eventTypes.deletedAt));
    // Same lock order as save and duplicate (schedule lock, rows, slug lock): those hold a row lock while waiting for
    // the slug lock, so taking the slug lock first and then updating their rows here could deadlock.
    if (first.ownerUserId && !first.teamId) await lockUserSchedules(tx, first.ownerUserId);
    await advisoryXactLock(tx, slugLockKey(first));
    const others = await tx
      .select({ id: eventTypes.id })
      .from(eventTypes)
      .where(and(scope, notInArray(eventTypes.id, unique)))
      .orderBy(asc(eventTypes.position), asc(eventTypes.createdAt));
    const order = [...unique, ...others.map((o) => o.id)];
    const stamp = now();
    for (const [position, id] of order.entries()) {
      await tx.update(eventTypes).set({ position, updatedAt: stamp }).where(eq(eventTypes.id, id));
    }
  });
}

/**
 * ET-12 delete: soft delete (past meetings keep their reference, the slug becomes reusable), pending single-use links
 * expire, audited (GEN-17). Owners delete their types; org owners and admins any type of their org.
 */
export async function deleteEventType(db: DB | DbOrTx, actor: ActorCtx, id: string): Promise<void> {
  await withTx(db as DB, async (tx) => {
    const access = await requireAccess(actor, id, tx);
    if (access !== "owner" && !isOrgAdmin(actor)) throw new AppError("forbidden", "Only the owner can delete this event type.");
    const row = await loadRow(tx, id, { forUpdate: true });
    const stamp = now();
    await tx.update(eventTypes).set({ deletedAt: stamp, updatedAt: stamp }).where(eq(eventTypes.id, id));
    await tx
      .update(singleUseLinks)
      .set({ status: "expired", updatedAt: stamp })
      .where(and(eq(singleUseLinks.eventTypeId, id), eq(singleUseLinks.status, "active")));
    await audit(
      {
        action: "event_type.deleted",
        namespace: "event_types",
        targetType: "event_type",
        targetId: id,
        details: { name: row.name, slug: row.slug },
        actor,
      },
      tx,
    );
    await publishEvent(tx, "event_type.deleted", { eventTypeId: id }, { organizationId: row.organizationId, actor: eventActor(actor) });
  });
}

/**
 * ET-11 duplicate: "{Name} (copy)" with slug "{slug}-copy" (then "-copy-2", ...), every setting, locations (new ids),
 * questions, hosts and pools, the custom schedule copied as a new custom schedule, reminders and workflow and coupon
 * links; the on/off state is preserved and the copy sits right after the original. Booked meetings are not copied.
 */
export async function duplicateEventType(db: DB | DbOrTx, actor: ActorCtx, id: string): Promise<{ id: string; slug: string }> {
  return withTx(db as DB, async (tx) => {
    await requireEdit(actor, id, tx);
    const src = await lockForWrite(tx, id);
    await advisoryXactLock(tx, slugLockKey(src));
    const taken = await takenSlugs(tx, src);
    const slug = copySlugCandidates(src.slug).find((s) => !taken.has(s)) ?? dedupeSlug(`${src.slug.slice(0, 90)}-copy`, taken);

    const section = slugScope(src);
    if (section) {
      await tx
        .update(eventTypes)
        .set({ position: sql`${eventTypes.position} + 1` })
        .where(and(section, gt(eventTypes.position, src.position)));
    }

    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      deletedAt: _deletedAt,
      slug: _slug,
      name,
      shareCode,
      position,
      locations,
      scheduleId,
      ...rest
    } = src;
    const copiedLocations: LocationConfig[] = (locations ?? []).map((l) => ({ ...l, id: newId() }));
    const [copy] = await tx
      .insert(eventTypes)
      .values({
        ...rest,
        name: copyName(name),
        slug,
        shareCode: shareCode ? shortCode() : null,
        position: position + 1,
        locations: copiedLocations,
        scheduleId: null,
        createdByUserId: actor.user.id,
        managedSyncedAt: null,
      })
      .returning();
    if (!copy) throw new Error("duplicateEventType: insert returned no row");

    const questions = await tx.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, id)).orderBy(asc(eventTypeQuestions.position));
    if (questions.length) {
      await tx.insert(eventTypeQuestions).values(
        questions.map((q) => ({
          eventTypeId: copy.id,
          position: q.position,
          label: q.label,
          type: q.type,
          required: q.required,
          enabled: q.enabled,
          answerChoices: q.answerChoices,
          includeOther: q.includeOther,
        })),
      );
    }

    const pools = await tx.select().from(eventTypeHostPools).where(eq(eventTypeHostPools.eventTypeId, id)).orderBy(asc(eventTypeHostPools.position));
    const poolMap = new Map<string, string>();
    for (const p of pools) {
      const [np] = await tx
        .insert(eventTypeHostPools)
        .values({ eventTypeId: copy.id, name: p.name, distribution: p.distribution, position: p.position, countsResetAt: now() })
        .returning({ id: eventTypeHostPools.id });
      if (np) poolMap.set(p.id, np.id);
    }

    // Custom schedules (event level and per host) of the original are copied as new custom schedules (AV-11).
    const customs = await tx
      .select({ id: availabilitySchedules.id, userId: availabilitySchedules.userId })
      .from(availabilitySchedules)
      .where(and(eq(availabilitySchedules.eventTypeId, id), isNull(availabilitySchedules.deletedAt)));
    const customMap = new Map<string, string>();
    for (const c of customs) {
      const content = await getScheduleContent(c.id, tx);
      if (!content) continue;
      const created = await createCustomSchedule(tx, { eventTypeId: copy.id, userId: c.userId, from: content });
      customMap.set(c.id, created.id);
    }
    const mapSchedule = (sid: string | null) => (sid ? (customMap.get(sid) ?? (customs.some((c) => c.id === sid) ? null : sid)) : null);
    await tx.update(eventTypes).set({ scheduleId: mapSchedule(scheduleId) }).where(eq(eventTypes.id, copy.id));

    const hosts = await tx.select().from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, id)).orderBy(asc(eventTypeHosts.position));
    if (hosts.length) {
      await tx.insert(eventTypeHosts).values(
        hosts.map((h) => ({
          eventTypeId: copy.id,
          userId: h.userId,
          poolId: h.poolId ? (poolMap.get(h.poolId) ?? null) : null,
          priority: h.priority,
          scheduleId: mapSchedule(h.scheduleId),
          locationOverride: h.locationOverride ? { ...h.locationOverride, id: newId() } : null,
          position: h.position,
        })),
      );
    }

    // Shared workflows linked to the original apply to the copy too; basic reminders are copied by the workflows module.
    const links = await tx
      .select({ workflowId: workflowEventTypes.workflowId })
      .from(workflowEventTypes)
      .innerJoin(workflows, eq(workflows.id, workflowEventTypes.workflowId))
      .where(and(eq(workflowEventTypes.eventTypeId, id), eq(workflows.isBasic, false), isNull(workflows.deletedAt)));
    if (links.length) {
      await tx
        .insert(workflowEventTypes)
        .values(links.map((l) => ({ workflowId: l.workflowId, eventTypeId: copy.id })))
        .onConflictDoNothing();
    }
    if (src.type === "standard") await copyEventTypeReminders(tx, actor, { fromEventTypeId: id, toEventTypeId: copy.id });

    const coupons = await tx.select({ couponId: eventTypeCoupons.couponId }).from(eventTypeCoupons).where(eq(eventTypeCoupons.eventTypeId, id));
    if (coupons.length) {
      await tx
        .insert(eventTypeCoupons)
        .values(coupons.map((c) => ({ eventTypeId: copy.id, couponId: c.couponId })))
        .onConflictDoNothing();
    }

    await publishEvent(tx, "event_type.created", { eventTypeId: copy.id }, { organizationId: copy.organizationId, actor: eventActor(actor) });
    return { id: copy.id, slug };
  });
}

/** The access level helper re-exported for pages (view, edit, owner). */
export async function eventTypeAccessFor(actor: ActorCtx, id: string, db: DbOrTx) {
  const access = await eventTypeAccess(actor, id, db);
  assertAccess(access, NOT_FOUND);
  return access;
}
