// Scheduling list on PGlite (SPEC ET-03, ET-06, ET-07, ET-08, ET-09, ET-12): the list query of the personal section
// with the URL filters, the bulk services (delete and On/Off in one transaction, all or nothing, authorized per row,
// audited) and their Server Actions (auth, validation, refresh). Other modules' contracts are mocked: workflows,
// calendars and conferencing (imported by the event type queries).
import { and, eq, inArray, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workflows", () => ({
  copyEventTypeReminders: vi.fn(async () => 0),
  getEventTypeReminders: vi.fn(async () => null),
}));
vi.mock("@/lib/calendars", () => ({ getDestinationCalendar: vi.fn(async () => null) }));
vi.mock("@/lib/conferencing", () => ({ getConferencingOptions: vi.fn(async () => ({})) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const sessionState: { user: unknown } = { user: null };
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSession: async () => (sessionState.user ? { session: { id: "s", twoFactorPending: false }, user: sessionState.user } : null),
  touchSession: async () => {},
}));

import { revalidatePath } from "next/cache";
import { bulkDeleteEventTypesAction, bulkSetEventTypesActiveAction } from "@/app/(dashboard)/app/scheduling/actions";
import { bulkDeleteEventTypes, bulkSetEventTypesActive } from "@/app/(dashboard)/app/scheduling/_components/bulk";
import { DEFAULT_FILTERS, filterEventTypes, parseListFilters } from "@/app/(dashboard)/app/scheduling/_components/list-filters";
import { BULK_MAX } from "@/app/(dashboard)/app/scheduling/_components/schemas";
import { auditLog, domainEvents, eventTypes, singleUseLinks } from "@/db/schema";
import { loadActorCtx, type ActorCtx } from "@/lib/authz";
import { AppError, isAppError } from "@/lib/errors";
import { listEventTypes, reorderEventTypes, setEventTypeActive } from "@/lib/event-types";
import {
  createEventType,
  createSchedule,
  createSingleUseLink,
  createTeam,
  createUser,
  googleMeetLocation,
  newId,
  type TestUser,
} from "../factories";
import { useTestDb } from "../helpers/db";

const t = useTestDb();

beforeEach(() => {
  sessionState.user = null;
  vi.mocked(revalidatePath).mockClear();
});

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

type Owner = { user: TestUser; actor: ActorCtx; ids: { thirty: string; sixty: string; meal: string } };

/** The owner's three event types (30 min, 60 min, meal) at positions 0, 1, 2, like the seed. */
async function owner(slug?: string): Promise<Owner> {
  const user = await createUser(t.db, { timezone: "America/Los_Angeles", ...(slug ? { slug } : {}) });
  await createSchedule(t.db, { userId: user.id, name: "Working hours", timezone: "America/Los_Angeles" });
  const mk = async (name: string, s: string, position: number, extra: Parameters<typeof createEventType>[1] = {}) =>
    (await createEventType(t.db, { owner: user, name, slug: s, locations: [googleMeetLocation()], overrides: { position, color: "#8247f5" }, ...extra })).eventType.id;
  const thirty = await mk("30 Minute Virtual", "30min", 0);
  const sixty = await mk("60 Minute Virtual", "60min", 1, { durationMinutes: 60 });
  const meal = await mk("In-Person Meal or Coffee", "meal", 2, { durationMinutes: 120, locations: [] });
  return { user, actor: await loadActorCtx(t.db, user), ids: { thirty, sixty, meal } };
}

const rowsOf = (ids: string[]) => t.db.select().from(eventTypes).where(inArray(eventTypes.id, ids));

describe("list query of the personal section (ET-03, ET-04, ET-06)", () => {
  it("lists only the user's live personal standard event types, in position order, with card summaries", async () => {
    const f = await owner("julian-list");
    const other = await owner();
    const { team } = await createTeam(t.db, { organizationId: f.user.organizationId });
    await createEventType(t.db, { team, name: "Team intro", slug: "team-intro" });
    await createEventType(t.db, { owner: f.user, name: "One-off", slug: "one-off", type: "adhoc" });
    await createEventType(t.db, { owner: f.user, name: "Gone", slug: "gone", overrides: { deletedAt: new Date() } });

    const list = await listEventTypes(f.actor, t.db);
    expect(list.map((e) => e.name)).toEqual(["30 Minute Virtual", "60 Minute Virtual", "In-Person Meal or Coffee"]);
    expect(list.map((e) => e.id)).not.toContain(other.ids.thirty);
    const first = list[0]!;
    expect(first).toMatchObject({
      slug: "30min",
      kindLabel: "One-on-One",
      durations: [30],
      locationSummary: "Google Meet",
      availabilitySummary: expect.stringMatching(/^Weekdays, 9/),
      publicPath: "/julian-list/30min",
      publicUrl: "http://localhost:3000/julian-list/30min",
      access: "owner",
      active: true,
      secret: false,
    });
  });

  it("applies the URL filters to the list: search by name or slug, Status On/Off", async () => {
    const f = await owner();
    await setEventTypeActive(t.db, f.actor, f.ids.sixty, false);
    const list = await listEventTypes(f.actor, t.db);
    const names = (query: string) => filterEventTypes(list, parseListFilters(new URLSearchParams(query))).map((e) => e.name);
    expect(names("q=virtual")).toEqual(["30 Minute Virtual", "60 Minute Virtual"]);
    expect(names("q=MEAL")).toEqual(["In-Person Meal or Coffee"]);
    expect(names("status=off")).toEqual(["60 Minute Virtual"]);
    expect(names("status=on&q=virtual")).toEqual(["30 Minute Virtual"]);
    expect(names("kind=group")).toEqual([]);
    expect(filterEventTypes(list, DEFAULT_FILTERS)).toHaveLength(3);
  });

  it("reorder persists the positions the landing page uses (ET-07)", async () => {
    const f = await owner();
    await reorderEventTypes(t.db, f.actor, [f.ids.meal, f.ids.thirty, f.ids.sixty]);
    const list = await listEventTypes(f.actor, t.db);
    expect(list.map((e) => e.slug)).toEqual(["meal", "30min", "60min"]);
    const rows = await rowsOf(Object.values(f.ids));
    expect(Object.fromEntries(rows.map((r) => [r.slug, r.position]))).toEqual({ meal: 0, "30min": 1, "60min": 2 });
  });
});

describe("bulk services (ET-08)", () => {
  it("deletes every selected event type in one go (soft delete, audit, domain events, single-use links expire)", async () => {
    const f = await owner();
    const link = await createSingleUseLink(t.db, { eventType: (await rowsOf([f.ids.sixty]))[0]! });
    const ids = [f.ids.thirty, f.ids.sixty, f.ids.meal];
    expect(await bulkDeleteEventTypes(t.db, f.actor, [...ids, f.ids.thirty])).toEqual({ deleted: [...ids].sort() });

    const rows = await rowsOf(ids);
    expect(rows.every((r) => r.deletedAt instanceof Date)).toBe(true);
    expect(await listEventTypes(f.actor, t.db)).toEqual([]);
    const logs = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "event_type.deleted"), inArray(auditLog.targetId, ids)));
    expect(logs).toHaveLength(3);
    const events = await t.db.select().from(domainEvents).where(eq(domainEvents.type, "event_type.deleted"));
    expect(ids.every((id) => events.some((e) => (e.payload as { eventTypeId?: string }).eventTypeId === id))).toBe(true);
    const [l] = await t.db.select().from(singleUseLinks).where(eq(singleUseLinks.id, link.id));
    expect(l?.status).toBe("expired");
  });

  it("is all or nothing: another person's event type in the selection leaves every row untouched", async () => {
    const f = await owner();
    const other = await owner();
    await expectError(bulkDeleteEventTypes(t.db, f.actor, [f.ids.thirty, other.ids.thirty, f.ids.meal]), "not_found");
    const live = await t.db.select({ id: eventTypes.id }).from(eventTypes).where(and(inArray(eventTypes.id, [f.ids.thirty, f.ids.meal, other.ids.thirty]), isNull(eventTypes.deletedAt)));
    expect(live).toHaveLength(3);
    await expectError(bulkSetEventTypesActive(t.db, f.actor, [f.ids.thirty, other.ids.sixty], false), "not_found");
    expect((await rowsOf([f.ids.thirty]))[0]?.active).toBe(true);
    await expectError(bulkDeleteEventTypes(t.db, f.actor, [f.ids.thirty, newId()]), "not_found");
    expect((await listEventTypes(f.actor, t.db))).toHaveLength(3);
  });

  it("turns the selection off and on; rows already in that state stay as they are", async () => {
    const f = await owner();
    await setEventTypeActive(t.db, f.actor, f.ids.meal, false);
    const before = (await rowsOf([f.ids.meal]))[0]!.updatedAt;
    expect(await bulkSetEventTypesActive(t.db, f.actor, [f.ids.thirty, f.ids.meal], false)).toEqual({ updated: [f.ids.thirty, f.ids.meal].sort(), active: false });
    let rows = await rowsOf(Object.values(f.ids));
    expect(Object.fromEntries(rows.map((r) => [r.slug, r.active]))).toEqual({ "30min": false, "60min": true, meal: false });
    expect(rows.find((r) => r.slug === "meal")!.updatedAt.getTime()).toBe(before.getTime());

    await bulkSetEventTypesActive(t.db, f.actor, Object.values(f.ids), true);
    rows = await rowsOf(Object.values(f.ids));
    expect(rows.every((r) => r.active)).toBe(true);
  });

  it("rejects an empty, oversized or malformed selection", async () => {
    const f = await owner();
    await expectError(bulkDeleteEventTypes(t.db, f.actor, []), "validation");
    await expectError(bulkSetEventTypesActive(t.db, f.actor, Array.from({ length: BULK_MAX + 1 }, () => newId()), true), "validation");
    await expectError(bulkDeleteEventTypes(t.db, f.actor, [f.ids.thirty, "not-a-uuid"]), "validation");
    expect(await listEventTypes(f.actor, t.db)).toHaveLength(3);
  });

  it("a stale selection (one type already deleted in another tab) still deletes the rest, without a second audit entry", async () => {
    const f = await owner();
    await bulkDeleteEventTypes(t.db, f.actor, [f.ids.thirty]);
    expect(await bulkDeleteEventTypes(t.db, f.actor, [f.ids.thirty, f.ids.sixty])).toEqual({ deleted: [f.ids.thirty, f.ids.sixty].sort() });
    expect((await listEventTypes(f.actor, t.db)).map((e) => e.slug)).toEqual(["meal"]);
    const logs = await t.db
      .select({ targetId: auditLog.targetId })
      .from(auditLog)
      .where(and(eq(auditLog.action, "event_type.deleted"), inArray(auditLog.targetId, Object.values(f.ids))));
    expect(logs.map((l) => l.targetId).sort()).toEqual([f.ids.thirty, f.ids.sixty].sort());
  });

  it("a stale selection toggles only the live event types", async () => {
    const f = await owner();
    await bulkDeleteEventTypes(t.db, f.actor, [f.ids.sixty]);
    expect(await bulkSetEventTypesActive(t.db, f.actor, [f.ids.sixty, f.ids.meal], false)).toEqual({ updated: [f.ids.meal], active: false });
    const rows = await rowsOf([f.ids.sixty, f.ids.meal]);
    expect(Object.fromEntries(rows.map((r) => [r.slug, r.active]))).toEqual({ "60min": true, meal: false });
    expect(await bulkSetEventTypesActive(t.db, f.actor, [f.ids.sixty], true)).toEqual({ updated: [], active: true });
  });

  it("someone else's deleted event type is still not found (nothing about other accounts leaks) and nothing changes", async () => {
    const f = await owner();
    const other = await owner();
    const colleague = await createUser(t.db, { organizationId: f.user.organizationId });
    const { eventType: colleagueType } = await createEventType(t.db, { owner: colleague, name: "Colleague", slug: "colleague" });
    await bulkDeleteEventTypes(t.db, other.actor, [other.ids.thirty]);
    await bulkDeleteEventTypes(t.db, await loadActorCtx(t.db, colleague), [colleagueType.id]);
    for (const foreign of [other.ids.thirty, colleagueType.id]) {
      await expectError(bulkDeleteEventTypes(t.db, f.actor, [f.ids.thirty, foreign]), "not_found");
      await expectError(bulkSetEventTypesActive(t.db, f.actor, [f.ids.meal, foreign], false), "not_found");
    }
    const rows = await rowsOf([f.ids.thirty, f.ids.meal]);
    expect(rows.every((r) => r.deletedAt === null && r.active)).toBe(true);
  });

  it("a team member with view access cannot bulk change team event types", async () => {
    const f = await owner();
    const member = await createUser(t.db, { organizationId: f.user.organizationId });
    const { team } = await createTeam(t.db, { organizationId: f.user.organizationId, members: [{ userId: member.id, role: "member" }] });
    const { eventType } = await createEventType(t.db, { team, name: "Team intro" });
    const actor = await loadActorCtx(t.db, member);
    await expectError(bulkSetEventTypesActive(t.db, actor, [eventType.id], false), "forbidden");
    await expectError(bulkDeleteEventTypes(t.db, actor, [eventType.id]), "forbidden");
    expect((await rowsOf([eventType.id]))[0]).toMatchObject({ active: true, deletedAt: null });
  });
});

describe("bulk Server Actions", () => {
  it("require a signed in user", async () => {
    const f = await owner();
    const r = await bulkDeleteEventTypesAction({ ids: [f.ids.thirty] });
    expect(r).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect((await rowsOf([f.ids.thirty]))[0]?.deletedAt).toBeNull();
  });

  it("validate the input with field errors", async () => {
    const f = await owner();
    sessionState.user = f.user;
    const r = await bulkSetEventTypesActiveAction({ ids: ["nope"], active: "maybe" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("validation");
    expect(Object.keys(r.error.fieldErrors ?? {})).toEqual(expect.arrayContaining(["active"]));
    const empty = await bulkDeleteEventTypesAction({ ids: [] });
    expect(empty).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("turn on/off and delete the selection, then refresh the Scheduling page", async () => {
    const f = await owner();
    sessionState.user = f.user;
    const off = await bulkSetEventTypesActiveAction({ ids: [f.ids.thirty, f.ids.sixty], active: false });
    expect(off).toMatchObject({ ok: true, data: { active: false } });
    expect(revalidatePath).toHaveBeenCalledWith("/app/scheduling");
    expect((await listEventTypes(f.actor, t.db)).filter((e) => !e.active).map((e) => e.slug)).toEqual(["30min", "60min"]);

    const del = await bulkDeleteEventTypesAction({ ids: [f.ids.thirty, f.ids.sixty, f.ids.meal] });
    expect(del).toMatchObject({ ok: true });
    expect(await listEventTypes(f.actor, t.db)).toEqual([]);
  });

  it("map a cross-account selection to a not found error without changing anything", async () => {
    const f = await owner();
    const other = await owner();
    sessionState.user = f.user;
    const r = await bulkDeleteEventTypesAction({ ids: [f.ids.thirty, other.ids.thirty] });
    expect(r).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await listEventTypes(f.actor, t.db)).toHaveLength(3);
    expect(await listEventTypes(other.actor, t.db)).toHaveLength(3);
  });
});
