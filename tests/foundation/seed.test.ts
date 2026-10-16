// Seed (SPEC ADM-10, ARCHITECTURE sections 23 and 24.2): the owner demo account exactly as observed, idempotent
// re-runs, the --demo extras (meetings in the next two weeks, two contacts, the three seedDemo() calls), the "team"
// scenario (round robin and collective), the CLI flags and POST /api/test/seed.
import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as seedPOST } from "@/app/api/test/seed/route";
import {
  availabilitySchedules,
  contactEmails,
  contacts,
  eventTypeHostPools,
  eventTypeHosts,
  eventTypeQuestions,
  eventTypes,
  handles,
  invitees,
  organizationMemberships,
  organizations,
  scheduledEventHosts,
  scheduledEvents,
  teamMemberships,
  teams,
  users,
} from "@/db/schema";
import type { LocationConfig } from "@/db/types";
import { verifyPassword } from "@/lib/crypto";
import { parseSeedArgs } from "../../scripts/seed.ts";
import { runSeed, type SeedResult } from "../../scripts/seed-scenarios.ts";
import { useTestDb } from "../helpers/db";

const demoCalls = vi.hoisted(() => ({ workflows: [] as unknown[], routing: [] as unknown[], polls: [] as unknown[] }));
vi.mock("@/lib/workflows/seed", () => ({
  seedDemo: vi.fn(async (_tx: unknown, ctx: unknown) => void demoCalls.workflows.push(ctx)),
}));
vi.mock("@/lib/routing/seed", () => ({
  seedDemo: vi.fn(async (_tx: unknown, ctx: unknown) => void demoCalls.routing.push(ctx)),
}));
vi.mock("@/lib/polls/seed", () => ({
  seedDemo: vi.fn(async (_tx: unknown, ctx: unknown) => void demoCalls.polls.push(ctx)),
}));

const t = useTestDb();

const r = (from: string, to: string) => {
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  return { start: m(from), end: m(to) };
};

async function counts() {
  const n = async (table: PgTable) => (await t.db.select({ n: count() }).from(table))[0]?.n ?? 0;
  return {
    users: await n(users),
    organizations: await n(organizations),
    memberships: await n(organizationMemberships),
    handles: await n(handles),
    schedules: await n(availabilitySchedules),
    eventTypes: await n(eventTypes),
    hosts: await n(eventTypeHosts),
    pools: await n(eventTypeHostPools),
    questions: await n(eventTypeQuestions),
    teams: await n(teams),
    teamMemberships: await n(teamMemberships),
    scheduledEvents: await n(scheduledEvents),
    scheduledEventHosts: await n(scheduledEventHosts),
    invitees: await n(invitees),
    contacts: await n(contacts),
    contactEmails: await n(contactEmails),
  };
}

describe("seed CLI flags", () => {
  it("defaults to the owner scenario without demo data", () => {
    expect(parseSeedArgs([])).toEqual({ scenario: "owner", demo: false, help: false });
    expect(parseSeedArgs(["--", "--demo", "--scenario=team"])).toEqual({ scenario: "team", demo: true, help: false });
    expect(parseSeedArgs(["--scenario=empty"]).scenario).toBe("empty");
    expect(parseSeedArgs(["-h"]).help).toBe(true);
  });

  it("rejects unknown scenarios and flags", () => {
    expect(() => parseSeedArgs(["--scenario=prod"])).toThrow(/Unknown scenario/);
    expect(() => parseSeedArgs(["--force"])).toThrow(/Unknown argument/);
  });
});

describe("owner scenario (ADM-10)", () => {
  let first: SeedResult;

  it("empty seeds nothing", async () => {
    expect(await runSeed(t.db, { scenario: "empty", demo: true })).toEqual({ scenario: "empty", demo: false });
    expect((await counts()).users).toBe(0);
  });

  it("creates the owner account with the observed profile", async () => {
    first = await runSeed(t.db, { scenario: "owner", demo: false });
    const [user] = await t.db.select().from(users).where(eq(users.emailNormalized, "owner@example.com"));
    expect(user).toMatchObject({
      name: "Julian Joseph",
      email: "owner@example.com",
      slug: "julianjoseph",
      timezone: "America/Los_Angeles",
      timeFormat: "12h",
      locale: "en",
      isInstanceAdmin: true,
      welcomeMessage: "Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.",
      avatarFileId: null,
      avatarUrl: null,
    });
    expect(user!.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user!.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(await verifyPassword("password123", user!.passwordHash)).toBe(true);
    expect(first.owner).toMatchObject({ userId: user!.id, slug: "julianjoseph", email: "owner@example.com" });

    const handleRows = await t.db.select().from(handles).where(eq(handles.userId, user!.id));
    expect(handleRows.map((h) => h.slug)).toEqual(["julianjoseph"]);
    const [membership] = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, user!.id));
    expect(membership).toMatchObject({ role: "owner", organizationId: first.owner!.organizationId });
  });

  it("creates the two schedules with the observed hours", async () => {
    const rows = await t.db
      .select()
      .from(availabilitySchedules)
      .where(eq(availabilitySchedules.userId, first.owner!.userId))
      .orderBy(asc(availabilitySchedules.createdAt));
    expect(rows.map((s) => [s.name, s.isDefault, s.timezone])).toEqual([
      ["Working hours", true, "America/Los_Angeles"],
      ["Block Off Work", false, "America/Los_Angeles"],
    ]);
    expect(rows[0]!.weeklyHours).toEqual([
      [r("14:00", "19:00")],
      [r("12:00", "17:00")],
      [r("11:00", "23:00")],
      [r("11:00", "23:00")],
      [r("11:00", "20:00")],
      [r("11:00", "17:00")],
      [],
    ]);
    expect(rows[1]!.weeklyHours).toEqual([
      [r("13:00", "21:00")],
      [r("17:00", "17:00")],
      [r("17:00", "20:00")],
      [r("17:00", "20:00")],
      [r("17:00", "20:00")],
      [r("17:00", "17:00")],
      [],
    ]);
    expect(first.owner!.scheduleIds).toEqual({ working_hours: rows[0]!.id, block_off_work: rows[1]!.id });
  });

  it("creates the three event types exactly as observed", async () => {
    const owner = first.owner!;
    const rows = await t.db
      .select()
      .from(eventTypes)
      .where(and(eq(eventTypes.ownerUserId, owner.userId), isNull(eventTypes.deletedAt)))
      .orderBy(asc(eventTypes.position));
    expect(
      rows.map((e) => ({
        name: e.name,
        slug: e.slug,
        duration: e.durationMinutes,
        color: e.color,
        position: e.position,
        increment: e.slotIncrementMinutes,
        before: e.bufferBeforeMinutes,
        after: e.bufferAfterMinutes,
        schedule: e.scheduleId,
      })),
    ).toEqual([
      { name: "30 Minute Virtual", slug: "30min", duration: 30, color: "#8247f5", position: 0, increment: 15, before: 15, after: 15, schedule: owner.scheduleIds.working_hours },
      { name: "60 Minute Virtual", slug: "60min", duration: 60, color: "#8247f5", position: 1, increment: 15, before: 15, after: 15, schedule: owner.scheduleIds.working_hours },
      { name: "In-Person Meal or Coffee", slug: "meal", duration: 120, color: "#17e885", position: 2, increment: 15, before: 0, after: 0, schedule: owner.scheduleIds.block_off_work },
    ]);
    for (const e of rows) {
      expect(e).toMatchObject({ scope: "personal", type: "standard", kind: "solo", poolingType: null, active: true, secret: false, bookingMethod: "instant", organizationId: owner.organizationId });
    }
    expect(rows.map((e) => e.id)).toEqual([owner.eventTypeIds["30min"], owner.eventTypeIds["60min"], owner.eventTypeIds.meal]);

    const [virtual30, virtual60, meal] = rows as [(typeof rows)[number], (typeof rows)[number], (typeof rows)[number]];
    expect(virtual30.locations.map((l) => l.kind)).toEqual(["google_conference"]);
    expect(virtual60.locations.map((l) => l.kind)).toEqual(["google_conference"]);
    // ADM-10 acceptance: /julianjoseph/meal offers 9 location options (8 venues plus ask invitee).
    const mealLocations: LocationConfig[] = meal.locations;
    expect(mealLocations).toHaveLength(9);
    expect(mealLocations.slice(0, 8).every((l) => l.kind === "physical" && /^.+ - .+ - \$+/.test(l.location ?? "") && Boolean(l.additionalInfo))).toBe(true);
    expect(mealLocations[8]!.kind).toBe("ask_invitee");
    expect(mealLocations.map((l) => l.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(mealLocations.map((l) => l.id)).size).toBe(9);

    const hosts = await t.db.select().from(eventTypeHosts);
    expect(hosts).toHaveLength(3);
    expect(hosts.every((h) => h.userId === owner.userId && h.poolId === null)).toBe(true);

    const questions = await t.db.select().from(eventTypeQuestions).orderBy(asc(eventTypeQuestions.eventTypeId));
    expect(questions).toHaveLength(3);
    for (const q of questions) {
      expect(q).toMatchObject({ label: "What would you like to discuss?", type: "text", required: true, enabled: true, position: 0 });
    }
  });

  it("is idempotent: re-running updates in place instead of duplicating", async () => {
    const before = await counts();
    // Drift the data, then re-seed: everything returns to the seed values.
    await t.db.update(eventTypes).set({ name: "Renamed", color: "#000000" }).where(eq(eventTypes.slug, "30min"));
    await t.db.update(users).set({ timezone: "UTC" }).where(eq(users.id, first.owner!.userId));
    const again = await runSeed(t.db, { scenario: "owner", demo: false });
    expect(again.owner).toEqual(first.owner);
    expect(await counts()).toEqual(before);
    const [et] = await t.db.select().from(eventTypes).where(eq(eventTypes.id, first.owner!.eventTypeIds["30min"]!));
    expect(et).toMatchObject({ name: "30 Minute Virtual", color: "#8247f5" });
    const [user] = await t.db.select().from(users).where(eq(users.id, first.owner!.userId));
    expect(user!.timezone).toBe("America/Los_Angeles");
  });

  it("--demo adds meetings in the next two weeks, two contacts and calls the three seedDemo()", async () => {
    const result = await runSeed(t.db, { scenario: "owner", demo: true });
    const demo = result.demoData!;
    expect(demo.scheduledEventIds).toHaveLength(3);
    expect(demo.contactIds).toHaveLength(2);

    const meetings = await t.db.select().from(scheduledEvents).orderBy(asc(scheduledEvents.startAt));
    expect(meetings).toHaveLength(3);
    const nowMs = Date.now();
    for (const m of meetings) {
      expect(m.status).toBe("active");
      expect(m.organizerUserId).toBe(result.owner!.userId);
      expect(m.startAt.getTime()).toBeGreaterThan(nowMs);
      expect(m.startAt.getTime()).toBeLessThan(nowMs + 17 * 86_400_000);
      expect(m.endAt.getTime() - m.startAt.getTime()).toBe(m.durationMinutes * 60_000);
      expect(m.icsUid).toBe(`${m.id}@localhost:3000`);
      // Each meeting fits its event type's schedule (Pacific wall time).
      const etSlug = Object.entries(result.owner!.eventTypeIds).find(([, id]) => id === m.eventTypeId)![0];
      const scheduleId = etSlug === "meal" ? result.owner!.scheduleIds.block_off_work : result.owner!.scheduleIds.working_hours;
      const [schedule] = await t.db.select().from(availabilitySchedules).where(eq(availabilitySchedules.id, scheduleId));
      const local = DateTime.fromJSDate(m.startAt, { zone: "America/Los_Angeles" });
      const startMin = local.hour * 60 + local.minute;
      const day = schedule!.weeklyHours[local.weekday % 7]!;
      expect(day.some((iv) => iv.start <= startMin && startMin + m.durationMinutes <= iv.end)).toBe(true);
    }
    const hostRows = await t.db.select().from(scheduledEventHosts);
    expect(hostRows).toHaveLength(3);
    expect(hostRows.every((h) => h.role === "organizer" && h.isActive)).toBe(true);
    const virtualHost = hostRows.find((h) => h.eventTypeId === result.owner!.eventTypeIds["30min"])!;
    expect(virtualHost.bufferedStartAt.getTime()).toBe(virtualHost.startAt.getTime() - 15 * 60_000);
    expect(virtualHost.bufferedEndAt.getTime()).toBe(virtualHost.endAt.getTime() + 15 * 60_000);

    const inviteeRows = await t.db.select().from(invitees);
    expect(inviteeRows).toHaveLength(3);
    for (const inv of inviteeRows) {
      expect(inv.contactId).not.toBeNull();
      expect(inv.questionsAndAnswers).toHaveLength(1);
      expect(inv.questionsAndAnswers[0]).toMatchObject({ question: "What would you like to discuss?", position: 0 });
      expect(inv.locationAnswer?.configId).toBeTruthy();
    }
    const mealMeeting = meetings.find((m) => m.eventTypeId === result.owner!.eventTypeIds.meal)!;
    expect(mealMeeting.location).toMatchObject({ kind: "physical", status: null });
    expect(mealMeeting.location.location).toMatch(/ - /);

    const contactRows = await t.db.select().from(contacts).orderBy(asc(contacts.name));
    expect(contactRows.map((c) => c.name)).toEqual(["Daniel Okafor", "Maya Patel"]);
    expect(contactRows.every((c) => c.nextMeetingAt instanceof Date && c.ownerUserId === result.owner!.userId)).toBe(true);

    const ctx = { ownerUserId: result.owner!.userId, organizationId: result.owner!.organizationId, eventTypeIds: [result.owner!.eventTypeIds["30min"], result.owner!.eventTypeIds["60min"], result.owner!.eventTypeIds.meal] };
    expect(demoCalls.workflows).toEqual([ctx]);
    expect(demoCalls.routing).toEqual([ctx]);
    expect(demoCalls.polls).toEqual([ctx]);

    // Re-running --demo moves the same rows instead of adding new ones.
    const before = await counts();
    const again = await runSeed(t.db, { scenario: "owner", demo: true });
    expect(await counts()).toEqual(before);
    expect(new Set(again.demoData!.scheduledEventIds)).toEqual(new Set(demo.scheduledEventIds));
    expect(demoCalls.workflows).toHaveLength(2);
  });
});

describe("team scenario", () => {
  it("adds two members, the Sales team with a round robin and a collective type, idempotently", async () => {
    const result = await runSeed(t.db, { scenario: "team", demo: false });
    const owner = result.owner!;
    const team = result.team!;
    expect(Object.keys(team.memberIds).sort()).toEqual(["member1@example.com", "member2@example.com"]);

    const members = await t.db
      .select({ email: users.email, slug: users.slug, role: organizationMemberships.role, orgId: organizationMemberships.organizationId, hash: users.passwordHash })
      .from(users)
      .innerJoin(organizationMemberships, eq(organizationMemberships.userId, users.id))
      .orderBy(asc(users.email));
    expect(members.map((m) => [m.email, m.slug, m.role])).toEqual([
      ["member1@example.com", "taylormorgan", "admin"],
      ["member2@example.com", "jordanlee", "user"],
      ["owner@example.com", "julianjoseph", "owner"],
    ]);
    expect(members.every((m) => m.orgId === owner.organizationId)).toBe(true);
    expect(await verifyPassword("password123", members[0]!.hash)).toBe(true);

    const [teamRow] = await t.db.select().from(teams).where(eq(teams.id, team.teamId));
    expect(teamRow).toMatchObject({ name: "Sales", slug: "sales", organizationId: owner.organizationId });
    expect((await t.db.select().from(handles).where(eq(handles.slug, "sales")))[0]?.teamId).toBe(team.teamId);
    const tm = await t.db.select().from(teamMemberships).where(eq(teamMemberships.teamId, team.teamId));
    expect(Object.fromEntries(tm.map((m) => [m.userId, m.role]))).toEqual({
      [owner.userId]: "manager",
      [team.memberIds["member1@example.com"]!]: "manager",
      [team.memberIds["member2@example.com"]!]: "member",
    });

    const types = await t.db.select().from(eventTypes).where(eq(eventTypes.teamId, team.teamId)).orderBy(asc(eventTypes.position));
    expect(types.map((e) => [e.name, e.slug, e.poolingType, e.scope, e.ownerUserId, e.durationMinutes])).toEqual([
      ["Sales Intro", "intro", "round_robin", "team", null, 30],
      ["Team Demo", "demo", "collective", "team", null, 45],
    ]);
    const [rr, collective] = types as [(typeof types)[number], (typeof types)[number]];
    const pools = await t.db.select().from(eventTypeHostPools).where(eq(eventTypeHostPools.eventTypeId, rr.id));
    expect(pools).toHaveLength(1);
    const rrHosts = await t.db.select().from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, rr.id));
    expect(rrHosts).toHaveLength(3);
    expect(rrHosts.every((h) => h.poolId === pools[0]!.id)).toBe(true);
    const colHosts = await t.db.select().from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, collective.id));
    expect(colHosts).toHaveLength(3);
    expect(colHosts.every((h) => h.poolId === null)).toBe(true);
    expect(collective.organizerUserId).toBe(owner.userId);

    const before = await counts();
    const again = await runSeed(t.db, { scenario: "team", demo: false });
    expect(again.team).toEqual(team);
    expect(await counts()).toEqual(before);
  });
});

describe("POST /api/test/seed", () => {
  const SECRET = "test-secret-seed-1234567890";
  const env = process.env as Record<string, string | undefined>;
  const req = (body: unknown, secret: string | null = SECRET) =>
    new Request("http://localhost:3000/api/test/seed", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { "x-e2e-secret": secret } : {}) },
      body: JSON.stringify(body),
    });
  beforeEach(() => {
    env.E2E_TEST_MODE = "1";
    env.E2E_SECRET = SECRET;
    delete env.VERCEL;
  });
  afterEach(() => {
    delete env.E2E_TEST_MODE;
    delete env.E2E_SECRET;
    delete env.VERCEL;
  });

  it("is guarded like every test route", async () => {
    expect((await seedPOST(req({ scenario: "owner" }, null))).status).toBe(404);
    env.VERCEL = "1";
    expect((await seedPOST(req({ scenario: "owner" }))).status).toBe(404);
  });

  it("validates the scenario and seeds owner, team and empty", async () => {
    expect((await seedPOST(req({ scenario: "prod" }))).status).toBe(400);
    const empty = await seedPOST(req({ scenario: "empty" }));
    expect(await empty.json()).toEqual({ ok: true, scenario: "empty", demo: false });
    const res = await seedPOST(req({ scenario: "team" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SeedResult & { ok: boolean };
    expect(body.ok).toBe(true);
    expect(body.owner?.slug).toBe("julianjoseph");
    expect(body.team?.slug).toBe("sales");
    expect(Object.keys(body.team!.eventTypeIds).sort()).toEqual(["demo", "intro"]);
  });
});
