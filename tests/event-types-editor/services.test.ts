// Event type services on PGlite (SPEC ET-09 to ET-26, ET-31, ET-33, AV-11, CAL-20, GEN-17; ARCHITECTURE 5.4.5 rules
// and 18.7 cross-tenant checks). Other modules' contracts are mocked: workflows (reminder copy on duplicate),
// calendars (destination lookups) and conferencing.
import { and, asc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workflows", () => ({
  copyEventTypeReminders: vi.fn(async () => 0),
  getEventTypeReminders: vi.fn(async () => null),
}));
vi.mock("@/lib/calendars", () => ({
  getDestinationCalendar: vi.fn(async () => null),
}));
vi.mock("@/lib/conferencing", () => ({
  getConferencingOptions: vi.fn(async () => ({
    google_conference: { available: false, reason: "Not configured on this server" },
    jitsi_conference: { available: true },
  })),
}));

import {
  auditLog,
  availabilitySchedules,
  domainEvents,
  eventTypeHosts,
  eventTypePermissions,
  eventTypeQuestions,
  eventTypes,
  singleUseLinks,
} from "@/db/schema";
import { loadActorCtx, type ActorCtx } from "@/lib/authz";
import { AppError, isAppError } from "@/lib/errors";
import {
  checkSlugAvailability,
  deleteEventType,
  duplicateEventType,
  getEventTypeEditorData,
  getNewEventTypeEditorData,
  listEventTypes,
  reorderEventTypes,
  saveEventType,
  setEventTypeActive,
  setEventTypeSecret,
  setInternalNote,
} from "@/lib/event-types";
import { DEFAULT_QUESTION_LABEL, MESSAGES } from "@/lib/event-types/constants";
import type { EventTypeDraft } from "@/lib/event-types/types";
import { copyEventTypeReminders } from "@/lib/workflows";
import {
  createCalendarConnection,
  createConferencingConnection,
  createEventType,
  createSchedule,
  createSingleUseLink,
  createUser,
  type TestUser,
} from "../factories";
import { useTestDb } from "../helpers/db";

const t = useTestDb();
const h = (n: number) => n * 60;

async function actorOf(user: TestUser): Promise<ActorCtx> {
  return loadActorCtx(t.db, user);
}

async function expectError(p: Promise<unknown>, code: AppError["code"]): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (!isAppError(e)) throw e;
    expect(e.code).toBe(code);
    return e;
  }
  throw new Error(`expected ${code}`);
}

async function owner(opts: { slug?: string } = {}) {
  const user = await createUser(t.db, { timezone: "America/Los_Angeles", ...(opts.slug ? { slug: opts.slug } : {}) });
  const working = await createSchedule(t.db, { userId: user.id, name: "Working hours", timezone: "America/Los_Angeles" });
  const block = await createSchedule(t.db, {
    userId: user.id,
    name: "Block Off Work",
    isDefault: false,
    timezone: "America/Los_Angeles",
    weeklyHours: [[{ start: h(13), end: h(21) }], [], [{ start: h(17), end: h(20) }], [], [], [], []],
  });
  return { user, working, block, actor: await actorOf(user) };
}

async function newDraft(actor: ActorCtx, patch: Partial<EventTypeDraft> = {}): Promise<EventTypeDraft> {
  const data = await getNewEventTypeEditorData(actor, t.db);
  return { ...data.draft, ...patch };
}

async function create(actor: ActorCtx, patch: Partial<EventTypeDraft> = {}) {
  return saveEventType(t.db, actor, { id: null, version: null, kind: "one_on_one", draft: await newDraft(actor, patch) });
}

async function editorOf(actor: ActorCtx, id: string) {
  const data = await getEventTypeEditorData(actor, id, t.db);
  if (!data) throw new Error("no editor data");
  return data;
}

async function update(actor: ActorCtx, id: string, patch: Partial<EventTypeDraft>) {
  const data = await editorOf(actor, id);
  return saveEventType(t.db, actor, { id, version: data.version, draft: { ...data.draft, ...patch } });
}

const rowOf = async (id: string) => (await t.db.select().from(eventTypes).where(eq(eventTypes.id, id)))[0]!;

beforeEach(() => {
  vi.mocked(copyEventTypeReminders).mockClear();
});

describe("create (ET-14, ET-33)", () => {
  it("creating a one-on-one with only a name saves the ET-33 defaults", async () => {
    const f = await owner();
    const res = await create(f.actor, { name: "Coffee Chat" });
    expect(res.created).toBe(true);
    expect(res.slug).toBe("coffee-chat");
    const row = await rowOf(res.id);
    expect(row).toMatchObject({
      organizationId: f.user.organizationId,
      ownerUserId: f.user.id,
      scope: "personal",
      type: "standard",
      kind: "solo",
      poolingType: null,
      name: "Coffee Chat",
      color: "#8247f5",
      durationMinutes: 30,
      durationOptions: null,
      locations: [],
      scheduleId: f.working.id,
      dateRangeType: "rolling",
      dateRangeDays: 60,
      dateRangeMode: "calendar_days",
      minimumNoticeMinutes: 240,
      slotIncrementMinutes: 30,
      slotAlignment: "interval_start",
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      limitPerDay: null,
      limitPerWeek: null,
      limitPerMonth: null,
      timeZoneDisplay: "auto",
      nameFormat: "full",
      allowGuests: true,
      notificationType: "auto",
      includeCancelRescheduleLinks: true,
      afterBooking: "confirmation_page",
      scheduleAnotherEnabled: true,
      active: true,
      secret: false,
      locale: "en",
      maxInvitees: 1,
      position: 0,
    });
    const hosts = await t.db.select().from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, res.id));
    expect(hosts.map((x) => [x.userId, x.poolId])).toEqual([[f.user.id, null]]);
    const qs = await t.db.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, res.id));
    expect(qs.map((q) => [q.label, q.type, q.required, q.enabled])).toEqual([[DEFAULT_QUESTION_LABEL, "text", false, true]]);
    const events = await t.db.select().from(domainEvents).where(eq(domainEvents.type, "event_type.created"));
    expect(events.some((e) => (e.payload as { eventTypeId?: string }).eventTypeId === res.id)).toBe(true);
    expect(res.draft.questions[0]?.id).toBe(qs[0]?.id);
  });

  it("new colors rotate and positions append", async () => {
    const f = await owner();
    const a = await create(f.actor, { name: "A" });
    const second = await newDraft(f.actor);
    expect(second.color).toBe("#0099ff");
    const b = await saveEventType(t.db, f.actor, { id: null, version: null, draft: { ...second, name: "B" } });
    expect((await rowOf(a.id)).position).toBe(0);
    expect((await rowOf(b.id)).position).toBe(1);
  });

  it("de-duplicates generated slugs with -2 and rejects a typed slug that is taken (ET-15, ET-23)", async () => {
    const f = await owner();
    const first = await create(f.actor, { name: "Intro Call" });
    const second = await create(f.actor, { name: "Intro Call" });
    expect([first.slug, second.slug]).toEqual(["intro-call", "intro-call-2"]);
    const err = await expectError(create(f.actor, { name: "Other", slug: "intro-call" }), "conflict");
    expect(err.fieldErrors?.slug).toEqual([MESSAGES.slugTaken]);
  });

  it("rejects an invalid draft with field errors", async () => {
    const f = await owner();
    const err = await expectError(create(f.actor, { name: "", durations: [30, 30] }), "validation");
    expect(err.fieldErrors?.name).toEqual([MESSAGES.nameRequired]);
    expect(err.fieldErrors?.["durations.1"]).toEqual([MESSAGES.durationDuplicate]);
  });

  it("sanitizes the description and stores a plain copy (ET-18)", async () => {
    const f = await owner();
    const res = await create(f.actor, { descriptionHtml: '<p>Hello <script>alert(1)</script><a href="https://x.example" onclick="evil()">link</a></p>' });
    const row = await rowOf(res.id);
    expect(row.descriptionHtml).not.toContain("script");
    expect(row.descriptionHtml).not.toContain("onclick");
    expect(row.descriptionHtml).toContain('href="https://x.example"');
    expect(row.descriptionPlain).toContain("Hello");
  });
});

describe("update (ET-14 to ET-26)", () => {
  it("saves every section atomically and keeps question ids", async () => {
    const f = await owner();
    const { id } = await create(f.actor, { name: "Meal" });
    const before = await editorOf(f.actor, id);
    const keptQuestion = before.draft.questions[0]!;
    const venues = Array.from({ length: 8 }, (_, i) => ({
      id: crypto.randomUUID(),
      kind: "physical" as const,
      position: i,
      location: `Venue ${i + 1} - Downtown - $$\n[Business Casual Dress Code]`,
      additionalInfo: `${100 + i} Market Street`,
    }));
    const res = await saveEventType(t.db, f.actor, {
      id,
      version: before.version,
      draft: {
        ...before.draft,
        name: "In-Person Meal or Coffee",
        slug: "meal",
        color: "#17e885",
        durations: [120, 60],
        locations: [...venues, { id: crypto.randomUUID(), kind: "ask_invitee", position: 8, location: "Suggest a place" }],
        schedule: { kind: "schedule", scheduleId: f.block.id },
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
        slotIncrementMinutes: 15,
        limitPerDay: 2,
        limitPerWeek: 5,
        minimumNoticeMinutes: 1440,
        dateRange: { type: "fixed", days: 60, mode: "calendar_days", start: "2026-10-20", end: "2026-10-22" },
        timeZoneDisplay: "locked",
        lockedTimeZone: "America/Los_Angeles",
        allowGuests: false,
        questions: [
          { ...keptQuestion, label: "What would you like to discuss?", required: true },
          { id: crypto.randomUUID(), label: "Pick a cuisine", type: "single_select", required: false, enabled: true, answerChoices: ["Thai", "Italian"], includeOther: true },
        ],
        afterBooking: "redirect",
        redirectUrl: "https://example.com/thanks",
        redirectPassDetails: true,
      },
    });
    const row = await rowOf(id);
    expect(row).toMatchObject({
      name: "In-Person Meal or Coffee",
      slug: "meal",
      color: "#17e885",
      durationMinutes: 120,
      durationOptions: [60, 120],
      scheduleId: f.block.id,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      slotIncrementMinutes: 15,
      limitPerDay: 2,
      limitPerWeek: 5,
      minimumNoticeMinutes: 1440,
      dateRangeType: "fixed",
      dateRangeStart: "2026-10-20",
      dateRangeEnd: "2026-10-22",
      timeZoneDisplay: "locked",
      lockedTimeZone: "America/Los_Angeles",
      allowGuests: false,
      afterBooking: "redirect",
      redirectUrl: "https://example.com/thanks",
      redirectPassDetails: true,
    });
    expect(row.locations).toHaveLength(9);
    expect(row.locations[3]?.location).toBe("Venue 4 - Downtown - $$\n[Business Casual Dress Code]");
    expect(row.locations.map((l) => l.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const qs = await t.db.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, id)).orderBy(asc(eventTypeQuestions.position));
    expect(qs[0]?.id).toBe(keptQuestion.id);
    expect(qs.map((q) => [q.label, q.required, q.answerChoices, q.includeOther])).toEqual([
      ["What would you like to discuss?", true, [], false],
      ["Pick a cuisine", false, ["Thai", "Italian"], true],
    ]);
    expect(res.draft.questions.map((q) => q.id)).toEqual(qs.map((q) => q.id));
    expect(res.version).not.toBe(before.version);
  });

  it("removing questions deletes them; ids of other event types are never reused", async () => {
    const f = await owner();
    const a = await create(f.actor, { name: "A" });
    const b = await create(f.actor, { name: "B" });
    const foreignId = (await editorOf(f.actor, b.id)).draft.questions[0]!.id;
    await update(f.actor, a.id, {
      questions: [{ id: foreignId, label: "Mine", type: "string", required: false, enabled: true, answerChoices: [], includeOther: false }],
    });
    const qa = await t.db.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, a.id));
    const qb = await t.db.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, b.id));
    expect(qa.map((q) => q.label)).toEqual(["Mine"]);
    expect(qa[0]?.id).not.toBe(foreignId);
    expect(qb.map((q) => q.id)).toEqual([foreignId]);
    await update(f.actor, a.id, { questions: [] });
    expect(await t.db.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, a.id))).toHaveLength(0);
  });

  it("detects concurrent edits with the version", async () => {
    const f = await owner();
    const { id, version } = await create(f.actor);
    await update(f.actor, id, { name: "First" });
    const data = await editorOf(f.actor, id);
    await expectError(saveEventType(t.db, f.actor, { id, version, draft: { ...data.draft, name: "Stale" } }), "conflict");
  });

  it("On/Off and reordering elsewhere do not reject an open editor's save; a secret change does", async () => {
    const f = await owner();
    const a = await create(f.actor, { name: "A" });
    const b = await create(f.actor, { name: "B" });
    const open = await editorOf(f.actor, a.id);
    // The Scheduling list in another tab: turn it off and move it (both bump updated_at).
    await setEventTypeActive(t.db, f.actor, a.id, false);
    await reorderEventTypes(t.db, f.actor, [b.id, a.id]);
    const saved = await saveEventType(t.db, f.actor, { id: a.id, version: open.version, draft: { ...open.draft, name: "Renamed" } });
    expect(saved.draft.name).toBe("Renamed");
    expect((await rowOf(a.id)).active).toBe(false);
    // Making it secret changes what the editor shows and saves: the stale editor must reload.
    const again = await editorOf(f.actor, a.id);
    await setEventTypeSecret(t.db, f.actor, a.id, true);
    await expectError(saveEventType(t.db, f.actor, { id: a.id, version: again.version, draft: { ...again.draft, name: "Stale" } }), "conflict");
    // The version returned by the kebab action keeps the editor's own save working.
    const { version } = await setEventTypeSecret(t.db, f.actor, a.id, false);
    const fresh = await editorOf(f.actor, a.id);
    expect(fresh.version).toBe(version);
    await saveEventType(t.db, f.actor, { id: a.id, version, draft: { ...fresh.draft, name: "Fine" } });
    expect((await rowOf(a.id)).name).toBe("Fine");
  });

  it("stores notification template bodies sanitized (NT-08)", async () => {
    const f = await owner();
    const { id } = await create(f.actor);
    await update(f.actor, id, {
      notificationTemplates: {
        confirmationSubject: "Booked: {{event_name}}",
        confirmationBody: '<p onclick="steal()">Hi {{invitee_first_name}}</p><script>alert(1)</script><a href="javascript:alert(2)">x</a><a href="{{reschedule_url}}">Reschedule</a>',
        invitationDescription: "<p><br></p>",
      },
    });
    const t2 = (await rowOf(id)).notificationTemplates;
    expect(t2.confirmationSubject).toBe("Booked: {{event_name}}");
    expect(t2.confirmationBody).toContain("Hi {{invitee_first_name}}");
    expect(t2.confirmationBody).toContain('href="{{reschedule_url}}"');
    expect(t2.confirmationBody).not.toMatch(/script|onclick|javascript:/);
    expect(t2.invitationDescription).toBeUndefined();
  });

  it("keeps a valid leftover redirect URL and drops an invalid one with the confirmation page (ET-26)", async () => {
    const f = await owner();
    const { id } = await create(f.actor);
    await update(f.actor, id, { afterBooking: "confirmation_page", redirectUrl: "https://example.com/thanks" });
    expect((await rowOf(id)).redirectUrl).toBe("https://example.com/thanks");
    await update(f.actor, id, { afterBooking: "confirmation_page", redirectUrl: "example dot com" });
    expect((await rowOf(id)).redirectUrl).toBeNull();
    await expectError(update(f.actor, id, { afterBooking: "redirect", redirectUrl: "example dot com" }), "validation");
  });

  it("slug changes are unique per profile and audited (ET-23, GEN-17)", async () => {
    const f = await owner();
    const a = await create(f.actor, { name: "A", slug: "alpha" });
    const b = await create(f.actor, { name: "B", slug: "beta" });
    const err = await expectError(update(f.actor, b.id, { slug: "alpha" }), "conflict");
    expect(err.fieldErrors?.slug).toEqual([MESSAGES.slugTaken]);
    await update(f.actor, a.id, { slug: "alpha-2" });
    expect((await rowOf(a.id)).slug).toBe("alpha-2");
    const logs = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "event_type.slug_changed"), eq(auditLog.targetId, a.id)));
    expect(logs[0]?.details).toEqual({ from: "alpha", to: "alpha-2" });
    // Another person's identical slug is fine.
    const other = await owner();
    await create(other.actor, { name: "A", slug: "alpha-2" });
  });

  it("group event types keep a single duration and location (ARCHITECTURE 5.4.5)", async () => {
    const f = await owner();
    const group = (await createEventType(t.db, { owner: f.user, kind: "group", maxInvitees: 10, name: "Webinar" })).eventType;
    const err = await expectError(update(f.actor, group.id, { durations: [30, 60] }), "validation");
    expect(err.fieldErrors?.durations).toEqual([MESSAGES.durationGroup]);
    await update(f.actor, group.id, { name: "Webinar 2" });
    const row = await rowOf(group.id);
    expect([row.kind, row.durationOptions, row.allowGuests, row.notificationType]).toEqual(["group", null, false, "email_confirmation"]);
  });

  it("custom schedules: switching to custom saves event-only hours, switching back deletes them (AV-11)", async () => {
    const f = await owner();
    const { id } = await create(f.actor);
    const content = { timezone: "America/Los_Angeles", weeklyHours: [[], [{ start: h(8), end: h(12) }], [], [], [], [], []] as never, overrides: [{ date: "2026-12-24", intervals: [] }] };
    await update(f.actor, id, { schedule: { kind: "custom", content } });
    const custom = (await t.db.select().from(availabilitySchedules).where(and(eq(availabilitySchedules.eventTypeId, id), isNull(availabilitySchedules.deletedAt))))[0];
    expect(custom).toBeDefined();
    expect((await rowOf(id)).scheduleId).toBe(custom!.id);
    const data = await editorOf(f.actor, id);
    expect(data.draft.schedule.kind).toBe("custom");
    await update(f.actor, id, { schedule: { kind: "schedule", scheduleId: f.block.id } });
    expect((await rowOf(id)).scheduleId).toBe(f.block.id);
    const live = await t.db.select().from(availabilitySchedules).where(and(eq(availabilitySchedules.eventTypeId, id), isNull(availabilitySchedules.deletedAt)));
    expect(live).toHaveLength(0);
  });
});

describe("cross-tenant references (ARCHITECTURE 18.7)", () => {
  it("another organization's schedule, calendar or conferencing connection is forbidden (403)", async () => {
    const f = await owner();
    const stranger = await owner();
    const { id } = await create(f.actor);
    const foreignCal = (await createCalendarConnection(t.db, { userId: stranger.user.id })).calendars[0]!;
    const foreignZoom = await createConferencingConnection(t.db, { userId: stranger.user.id });

    const schedule = await expectError(update(f.actor, id, { schedule: { kind: "schedule", scheduleId: stranger.working.id } }), "forbidden");
    expect(schedule.status).toBe(403);
    expect((await expectError(update(f.actor, id, { destinationCalendarId: foreignCal.id }), "forbidden")).status).toBe(403);
    await expectError(
      update(f.actor, id, { locations: [{ id: crypto.randomUUID(), kind: "zoom_conference", position: 0, connectionId: foreignZoom.id }] }),
      "forbidden",
    );
    await expectError(create(f.actor, { schedule: { kind: "schedule", scheduleId: stranger.block.id } }), "forbidden");
    // Nothing was written.
    expect((await rowOf(id)).scheduleId).toBe(f.working.id);

    // The owner's own calendar works (CAL-20).
    const own = (await createCalendarConnection(t.db, { userId: f.user.id })).calendars[0]!;
    await update(f.actor, id, { destinationCalendarId: own.id });
    expect((await rowOf(id)).destinationCalendarId).toBe(own.id);
  });

  it("other organizations cannot read or change an event type (404)", async () => {
    const f = await owner();
    const stranger = await owner();
    const { id } = await create(f.actor);
    expect(await getEventTypeEditorData(stranger.actor, id, t.db)).toBeNull();
    const draft = (await editorOf(f.actor, id)).draft;
    await expectError(saveEventType(t.db, stranger.actor, { id, version: null, draft }), "not_found");
    await expectError(deleteEventType(t.db, stranger.actor, id), "not_found");
    await expectError(duplicateEventType(t.db, stranger.actor, id), "not_found");
    await expectError(setEventTypeSecret(t.db, stranger.actor, id, true), "not_found");
  });
});

describe("permissions (ET-31)", () => {
  it("a 'Can view' member sees a read-only editor and cannot save (403)", async () => {
    const f = await owner();
    const { id } = await create(f.actor);
    const viewer = await createUser(t.db, { organizationId: f.user.organizationId });
    await t.db.insert(eventTypePermissions).values({ eventTypeId: id, userId: viewer.id, level: "view" });
    const viewerActor = await actorOf(viewer);
    const data = await editorOf(viewerActor, id);
    expect(data.access).toBe("view");
    expect(data.canDelete).toBe(false);
    const err = await expectError(saveEventType(t.db, viewerActor, { id, version: data.version, draft: { ...data.draft, name: "Hacked" } }), "forbidden");
    expect(err.status).toBe(403);
    await expectError(setEventTypeActive(t.db, viewerActor, id, false), "forbidden");
    expect((await rowOf(id)).name).not.toBe("Hacked");
  });

  it("'Can edit' members save but only owners and org admins delete", async () => {
    const f = await owner();
    const { id } = await create(f.actor);
    const editor = await createUser(t.db, { organizationId: f.user.organizationId });
    await t.db.insert(eventTypePermissions).values({ eventTypeId: id, userId: editor.id, level: "edit" });
    const editorActor = await actorOf(editor);
    await update(editorActor, id, { name: "Edited by a teammate" });
    expect((await rowOf(id)).name).toBe("Edited by a teammate");
    await expectError(deleteEventType(t.db, editorActor, id), "forbidden");
    const admin = await createUser(t.db, { organizationId: f.user.organizationId, orgRole: "admin" });
    await deleteEventType(t.db, await actorOf(admin), id);
    expect((await rowOf(id)).deletedAt).not.toBeNull();
  });
});

describe("event-level actions", () => {
  it("toggles on/off and secret, and saves the internal note (ET-09, ET-10, ET-13)", async () => {
    const f = await owner();
    const { id } = await create(f.actor);
    await setEventTypeActive(t.db, f.actor, id, false);
    await setEventTypeSecret(t.db, f.actor, id, true);
    const note = await setInternalNote(t.db, f.actor, id, "  Only for VIPs  ");
    expect(note.note).toBe("Only for VIPs");
    expect(await rowOf(id)).toMatchObject({ active: false, secret: true, internalNote: "Only for VIPs" });
    await setInternalNote(t.db, f.actor, id, "");
    expect((await rowOf(id)).internalNote).toBeNull();
    const updates = await t.db.select().from(domainEvents).where(eq(domainEvents.type, "event_type.updated"));
    expect(updates.filter((e) => (e.payload as { eventTypeId?: string }).eventTypeId === id).length).toBeGreaterThanOrEqual(3);
  });

  it("reorders within a section (ET-07)", async () => {
    const f = await owner();
    const a = await create(f.actor, { name: "A" });
    const b = await create(f.actor, { name: "B" });
    const c = await create(f.actor, { name: "C" });
    await reorderEventTypes(t.db, f.actor, [c.id, a.id, b.id]);
    const list = await listEventTypes(f.actor, t.db);
    expect(list.map((e) => e.name)).toEqual(["C", "A", "B"]);
    expect(list.map((e) => e.position)).toEqual([0, 1, 2]);
    const other = await owner();
    const x = await create(other.actor, { name: "X" });
    await expectError(reorderEventTypes(t.db, f.actor, [a.id, x.id]), "validation");
  });

  it("checks slug availability for the Event link field (ET-23)", async () => {
    const f = await owner();
    const a = await create(f.actor, { name: "A", slug: "taken" });
    expect(await checkSlugAvailability(t.db, f.actor, { slug: "taken", eventTypeId: null })).toEqual({ slug: "taken", available: false, message: MESSAGES.slugTaken });
    expect((await checkSlugAvailability(t.db, f.actor, { slug: "taken", eventTypeId: a.id })).available).toBe(true);
    expect((await checkSlugAvailability(t.db, f.actor, { slug: "free-one", eventTypeId: null })).available).toBe(true);
    expect((await checkSlugAvailability(t.db, f.actor, { slug: "Bad Slug", eventTypeId: null })).available).toBe(false);
  });
});

describe("duplicate (ET-11)", () => {
  it("copies every setting, questions and the custom schedule, right after the original", async () => {
    const f = await owner();
    const first = await create(f.actor, { name: "30 Minute Virtual", slug: "30min" });
    const after = await create(f.actor, { name: "Later" });
    const content = { timezone: "America/Los_Angeles", weeklyHours: [[], [{ start: h(9), end: h(10) }], [], [], [], [], []] as never, overrides: [] };
    await update(f.actor, first.id, {
      durations: [30, 60],
      bufferBeforeMinutes: 15,
      limitPerDay: 3,
      locations: [{ id: crypto.randomUUID(), kind: "google_conference", position: 0 }],
      schedule: { kind: "custom", content },
    });
    await setEventTypeActive(t.db, f.actor, first.id, false);

    const copy = await duplicateEventType(t.db, f.actor, first.id);
    expect(copy.slug).toBe("30min-copy");
    const src = await rowOf(first.id);
    const dup = await rowOf(copy.id);
    expect(dup).toMatchObject({
      name: "30 Minute Virtual (copy)",
      durationMinutes: 30,
      durationOptions: [30, 60],
      bufferBeforeMinutes: 15,
      limitPerDay: 3,
      active: false,
      position: src.position + 1,
    });
    expect(dup.locations[0]?.kind).toBe("google_conference");
    expect(dup.locations[0]?.id).not.toBe(src.locations[0]?.id);
    expect((await rowOf(after.id)).position).toBe(src.position + 2);
    expect(dup.scheduleId).not.toBe(src.scheduleId);
    const customCopy = (await t.db.select().from(availabilitySchedules).where(eq(availabilitySchedules.id, dup.scheduleId!)))[0];
    expect(customCopy?.eventTypeId).toBe(copy.id);
    const qs = await t.db.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, copy.id));
    expect(qs.map((q) => q.label)).toEqual([DEFAULT_QUESTION_LABEL]);
    const hosts = await t.db.select().from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, copy.id));
    expect(hosts.map((x) => x.userId)).toEqual([f.user.id]);
    expect(copyEventTypeReminders).toHaveBeenCalledWith(expect.anything(), expect.anything(), { fromEventTypeId: first.id, toEventTypeId: copy.id });

    const again = await duplicateEventType(t.db, f.actor, first.id);
    expect(again.slug).toBe("30min-copy-2");
    const editor = await editorOf(f.actor, copy.id);
    expect(editor.draft.schedule.kind).toBe("custom");
  });
});

describe("delete (ET-12, GEN-17)", () => {
  it("soft deletes, audits, expires single-use links and frees the slug", async () => {
    const f = await owner();
    const { id } = await create(f.actor, { name: "Old", slug: "old" });
    const link = await createSingleUseLink(t.db, { eventType: await rowOf(id) });
    await deleteEventType(t.db, f.actor, id);
    expect((await rowOf(id)).deletedAt).not.toBeNull();
    expect((await t.db.select().from(singleUseLinks).where(eq(singleUseLinks.id, link.id)))[0]?.status).toBe("expired");
    const logs = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "event_type.deleted"), eq(auditLog.targetId, id)));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ namespace: "event_types", actorUserId: f.user.id, details: { name: "Old", slug: "old" } });
    expect((await t.db.select().from(domainEvents).where(eq(domainEvents.type, "event_type.deleted"))).some((e) => (e.payload as { eventTypeId?: string }).eventTypeId === id)).toBe(true);
    expect(await getEventTypeEditorData(f.actor, id, t.db)).toBeNull();
    expect((await listEventTypes(f.actor, t.db)).map((e) => e.id)).not.toContain(id);
    const again = await create(f.actor, { name: "New", slug: "old" });
    expect(again.slug).toBe("old");
  });
});

describe("queries", () => {
  it("editor data includes schedules, limits, the preview path and the link prefix", async () => {
    const f = await owner({ slug: "julian-test" });
    const { id } = await create(f.actor, { name: "Coffee" });
    const data = await editorOf(f.actor, id);
    expect(data.access).toBe("owner");
    expect(data.kindLabel).toBe("One-on-One");
    expect(data.previewPath).toBe("/julian-test/coffee?preview=1");
    expect(data.publicUrl).toBe("http://localhost:3000/julian-test/coffee");
    expect(data.linkPrefix).toBe("localhost:3000/julian-test/");
    expect(data.schedules.map((s) => [s.name, s.isDefault])).toEqual([
      ["Working hours", true],
      ["Block Off Work", false],
    ]);
    expect(data.conferencing.google_conference?.available).toBe(false);
    expect(data.hostLimits).toEqual({ day: null, week: null, month: null });
    const fresh = await getNewEventTypeEditorData(f.actor, t.db);
    expect(fresh.previewPath).toBe("/julian-test/__preview__?preview=1");
    expect(fresh.draft.schedule).toEqual({ kind: "schedule", scheduleId: f.working.id });
  });

  it("lists personal event types with summaries (ET-04)", async () => {
    const f = await owner();
    await create(f.actor, { name: "Virtual", locations: [{ id: crypto.randomUUID(), kind: "google_conference", position: 0 }], durations: [30, 60] });
    const [item] = await listEventTypes(f.actor, t.db);
    expect(item).toMatchObject({ name: "Virtual", kindLabel: "One-on-One", durations: [30, 60], locationSummary: "Google Meet", availabilitySummary: "Weekdays, 9 am - 5 pm" });
  });
});
