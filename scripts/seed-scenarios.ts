// Seed scenarios (SPEC ADM-10, ARCHITECTURE sections 23 and 24.2). Shared by the CLI (scripts/seed.ts, through tsx)
// and the E2E route POST /api/test/seed, so both produce exactly the same rows.
//
// - "owner": the owner demo account (Julian Joseph, julianjoseph, owner@example.com / password123, America/Los_Angeles,
//   12h), the schedules "Working hours" (default) and "Block Off Work" with the observed hours, and the event types
//   30min, 60min and meal with the observed colors, durations, 15 minute increments, buffers, locations and the
//   required "What would you like to discuss?" question (positions 0 to 2).
// - "team": the owner plus two members in the owner's organization and the team "Sales" with a round robin type
//   (intro) and a collective type (demo).
// - "empty": nothing (migrations only).
// - demo (flag): a few meetings in the next two weeks, two contacts and the seedDemo() of workflows, routing forms and
//   meeting polls (no-op stubs until their owners implement them).
//
// Idempotent: every row is looked up by its natural key (email, slug, schedule name, event type slug, metadata.seed)
// and updated in place, so re-running never duplicates. Accounts are created through createUserAccount (AU-13), the
// rest with direct inserts. Runs in one transaction. Never publishes booking events (no emails, no jobs) beyond the
// user.created event createUserAccount publishes for new accounts. Never embeds the owner's photo.
import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
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
  scheduledEventHosts,
  scheduledEvents,
  teamMemberships,
  teams,
  users,
} from "@/db/schema";
import type { LocationConfig, MeetingSettingsSnapshot, QuestionAnswer, ResolvedLocation, WeeklyHours } from "@/db/types";
import { ensureDefaultSchedule } from "@/lib/availability";
import { createUserAccount, DEFAULT_QUESTION_LABEL, type UserRow } from "@/lib/auth/signup";
import { hashPassword } from "@/lib/crypto";
import { newId } from "@/lib/ids";
import { seedDemo as seedPollsDemo } from "@/lib/polls/seed";
import { seedDemo as seedRoutingDemo } from "@/lib/routing/seed";
import { claimHandle } from "@/lib/slugs";
import { addDays, localDateOf, wallClockToUtc, weekdayOf } from "@/lib/time/luxon";
import { now } from "@/lib/time/now";
import { appHost } from "@/lib/url";
import { normalizeEmail } from "@/lib/validation";
import { seedDemo as seedWorkflowsDemo } from "@/lib/workflows/seed";
import {
  DEMO_CONTACTS,
  DEMO_MEETINGS,
  OWNER,
  OWNER_EVENT_TYPES,
  OWNER_SCHEDULES,
  TEAM_SCENARIO,
  type SeedEventType,
  type SeedScheduleKey,
} from "./seed-data.ts";

export type SeedScenario = "owner" | "team" | "empty";
export type SeedOptions = { scenario: SeedScenario; demo: boolean };

export type SeededOwner = {
  userId: string;
  organizationId: string;
  email: string;
  slug: string;
  scheduleIds: Record<SeedScheduleKey, string>;
  /** By slug: 30min, 60min, meal. */
  eventTypeIds: Record<string, string>;
};

export type SeededTeam = {
  teamId: string;
  slug: string;
  /** By email: member1@example.com, member2@example.com. */
  memberIds: Record<string, string>;
  /** By slug: intro (round robin), demo (collective). */
  eventTypeIds: Record<string, string>;
};

export type SeededDemo = { scheduledEventIds: string[]; inviteeIds: string[]; contactIds: string[] };

export type SeedResult = {
  scenario: SeedScenario;
  demo: boolean;
  owner?: SeededOwner;
  team?: SeededTeam;
  demoData?: SeededDemo;
};

export const SEED_SCENARIOS: readonly SeedScenario[] = ["owner", "team", "empty"];

export function isSeedScenario(value: unknown): value is SeedScenario {
  return typeof value === "string" && (SEED_SCENARIOS as readonly string[]).includes(value);
}

/** Runs a scenario in one transaction and returns the ids of what it seeded. */
export async function runSeed(db: DB, opts: SeedOptions): Promise<SeedResult> {
  if (opts.scenario === "empty") return { scenario: "empty", demo: false };
  return db.transaction(async (tx) => {
    const owner = await seedOwner(tx);
    const result: SeedResult = { scenario: opts.scenario, demo: opts.demo, owner };
    if (opts.scenario === "team") result.team = await seedTeam(tx, owner);
    if (opts.demo) result.demoData = await seedDemoExtras(tx, owner);
    return result;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Accounts

type AccountSpec = {
  name: string;
  email: string;
  password: string;
  timezone: string;
  slug: string;
  isInstanceAdmin: boolean;
  welcomeMessage?: string;
  /** Join this organization (members); omitted for the owner (own organization). */
  organizationId?: string;
  role?: "admin" | "user";
};

async function findLiveUser(tx: DbOrTx, email: string): Promise<UserRow | null> {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.emailNormalized, normalizeEmail(email)), isNull(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Creates the account through createUserAccount or updates it in place; returns the user and its organization. */
async function upsertAccount(tx: DbOrTx, spec: AccountSpec): Promise<{ user: UserRow; organizationId: string }> {
  const passwordHash = await hashPassword(spec.password);
  const at = now();
  let user = await findLiveUser(tx, spec.email);
  if (!user) {
    user = await createUserAccount(tx, {
      email: spec.email,
      name: spec.name,
      passwordHash,
      timezone: spec.timezone,
      slug: spec.slug,
      locale: "en",
      emailVerifiedAt: at,
      isInstanceAdmin: spec.isInstanceAdmin,
      organizationId: spec.organizationId ?? null,
      role: spec.role,
    });
  }

  const [membership] = await tx
    .select()
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, user.id))
    .limit(1);
  if (!membership) throw new Error(`[seed] ${spec.email} has no organization membership`);
  if (spec.organizationId && membership.organizationId !== spec.organizationId) {
    throw new Error(
      `[seed] ${spec.email} already belongs to another organization; reset the database (or remove that account) and seed again`,
    );
  }
  if (spec.organizationId && spec.role && membership.role !== spec.role && membership.role !== "owner") {
    await tx.update(organizationMemberships).set({ role: spec.role }).where(eq(organizationMemberships.id, membership.id));
  }

  if (user.slug !== spec.slug) await claimHandle(tx, spec.slug, { userId: user.id });

  const [updated] = await tx
    .update(users)
    .set({
      name: spec.name,
      email: spec.email,
      passwordHash,
      timezone: spec.timezone,
      locale: "en",
      timeFormat: "12h",
      isInstanceAdmin: spec.isInstanceAdmin,
      emailVerifiedAt: user.emailVerifiedAt ?? at,
      onboardingCompletedAt: user.onboardingCompletedAt ?? at,
      ...(spec.welcomeMessage ? { welcomeMessage: spec.welcomeMessage } : {}),
    })
    .where(eq(users.id, user.id))
    .returning();
  if (!updated) throw new Error(`[seed] ${spec.email} vanished`);
  return { user: updated, organizationId: membership.organizationId };
}

// ---------------------------------------------------------------------------------------------------------------
// Owner scenario

async function upsertSchedule(
  tx: DbOrTx,
  userId: string,
  spec: (typeof OWNER_SCHEDULES)[number],
): Promise<string> {
  const values = { name: spec.name, timezone: spec.timezone, weeklyHours: spec.weeklyHours, deletedAt: null };
  if (spec.isDefault) {
    const schedule = await ensureDefaultSchedule(tx, userId, {
      timezone: spec.timezone,
      name: spec.name,
      weeklyHours: spec.weeklyHours,
    });
    await tx.update(availabilitySchedules).set(values).where(eq(availabilitySchedules.id, schedule.id));
    return schedule.id;
  }
  const [existing] = await tx
    .select({ id: availabilitySchedules.id })
    .from(availabilitySchedules)
    .where(
      and(
        eq(availabilitySchedules.userId, userId),
        eq(availabilitySchedules.name, spec.name),
        eq(availabilitySchedules.isDefault, false),
        isNull(availabilitySchedules.eventTypeId),
        isNull(availabilitySchedules.singleUseLinkId),
        isNull(availabilitySchedules.deletedAt),
      ),
    )
    .orderBy(asc(availabilitySchedules.createdAt))
    .limit(1);
  if (existing) {
    await tx.update(availabilitySchedules).set(values).where(eq(availabilitySchedules.id, existing.id));
    return existing.id;
  }
  const [inserted] = await tx
    .insert(availabilitySchedules)
    .values({ userId, isDefault: false, ...values })
    .returning({ id: availabilitySchedules.id });
  if (!inserted) throw new Error("[seed] schedule insert returned no row");
  return inserted.id;
}

type QuestionSpec = { label: string; type: (typeof eventTypeQuestions.$inferInsert)["type"]; required: boolean };

/** Makes the event type's questions exactly `specs` (updates in place, deletes extras). */
async function syncQuestions(tx: DbOrTx, eventTypeId: string, specs: QuestionSpec[]): Promise<void> {
  const existing = await tx
    .select({ id: eventTypeQuestions.id })
    .from(eventTypeQuestions)
    .where(eq(eventTypeQuestions.eventTypeId, eventTypeId))
    .orderBy(asc(eventTypeQuestions.position), asc(eventTypeQuestions.createdAt));
  for (const [i, q] of specs.entries()) {
    const values = {
      position: i,
      label: q.label,
      type: q.type,
      required: q.required,
      enabled: true,
      answerChoices: [] as string[],
      includeOther: false,
    };
    const row = existing[i];
    if (row) await tx.update(eventTypeQuestions).set(values).where(eq(eventTypeQuestions.id, row.id));
    else await tx.insert(eventTypeQuestions).values({ eventTypeId, ...values });
  }
  const extra = existing.slice(specs.length).map((r) => r.id);
  if (extra.length) await tx.delete(eventTypeQuestions).where(inArray(eventTypeQuestions.id, extra));
}

/** Makes the event type's hosts exactly `hosts` (in order). */
async function syncHosts(
  tx: DbOrTx,
  eventTypeId: string,
  hosts: { userId: string; poolId: string | null }[],
): Promise<void> {
  for (const [i, h] of hosts.entries()) {
    await tx
      .insert(eventTypeHosts)
      .values({ eventTypeId, userId: h.userId, poolId: h.poolId, priority: 3, position: i })
      .onConflictDoUpdate({
        target: [eventTypeHosts.eventTypeId, eventTypeHosts.userId],
        set: { poolId: h.poolId, position: i },
      });
  }
  await tx.delete(eventTypeHosts).where(
    and(
      eq(eventTypeHosts.eventTypeId, eventTypeId),
      notInArray(
        eventTypeHosts.userId,
        hosts.map((h) => h.userId),
      ),
    ),
  );
}

async function upsertOwnerEventType(
  tx: DbOrTx,
  owner: { userId: string; organizationId: string },
  spec: SeedEventType,
  scheduleId: string,
): Promise<string> {
  const values = {
    name: spec.name,
    color: spec.color,
    durationMinutes: spec.durationMinutes,
    durationOptions: null,
    position: spec.position,
    locations: spec.locations,
    scheduleId,
    availabilitySetting: "host" as const,
    slotIncrementMinutes: spec.slotIncrementMinutes,
    bufferBeforeMinutes: spec.bufferBeforeMinutes,
    bufferAfterMinutes: spec.bufferAfterMinutes,
    kind: "solo" as const,
    poolingType: null,
    maxInvitees: 1,
    bookingMethod: "instant" as const,
    active: true,
    secret: false,
    locale: "en",
  };
  const [existing] = await tx
    .select({ id: eventTypes.id })
    .from(eventTypes)
    .where(
      and(
        eq(eventTypes.ownerUserId, owner.userId),
        eq(eventTypes.slug, spec.slug),
        isNull(eventTypes.teamId),
        eq(eventTypes.scope, "personal"),
        eq(eventTypes.type, "standard"),
        isNull(eventTypes.deletedAt),
      ),
    )
    .limit(1);
  let id: string;
  if (existing) {
    await tx.update(eventTypes).set(values).where(eq(eventTypes.id, existing.id));
    id = existing.id;
  } else {
    const [inserted] = await tx
      .insert(eventTypes)
      .values({
        organizationId: owner.organizationId,
        ownerUserId: owner.userId,
        scope: "personal",
        type: "standard",
        slug: spec.slug,
        createdByUserId: owner.userId,
        ...values,
      })
      .returning({ id: eventTypes.id });
    if (!inserted) throw new Error("[seed] event type insert returned no row");
    id = inserted.id;
  }
  await syncHosts(tx, id, [{ userId: owner.userId, poolId: null }]);
  await syncQuestions(tx, id, spec.questions);
  return id;
}

/** The owner demo account of SPEC ADM-10 (created or updated in place). */
export async function seedOwner(tx: DbOrTx): Promise<SeededOwner> {
  const { user, organizationId } = await upsertAccount(tx, {
    name: OWNER.name,
    email: OWNER.email,
    password: OWNER.password,
    timezone: OWNER.timezone,
    slug: OWNER.slug,
    isInstanceAdmin: true, // AU-11: the first account of an instance is its admin
    welcomeMessage: OWNER.welcomeMessage,
  });
  const scheduleIds = {} as Record<SeedScheduleKey, string>;
  for (const s of OWNER_SCHEDULES) scheduleIds[s.key] = await upsertSchedule(tx, user.id, s);
  const eventTypeIds: Record<string, string> = {};
  for (const spec of OWNER_EVENT_TYPES) {
    eventTypeIds[spec.slug] = await upsertOwnerEventType(
      tx,
      { userId: user.id, organizationId },
      spec,
      scheduleIds[spec.schedule],
    );
  }
  return { userId: user.id, organizationId, email: OWNER.email, slug: OWNER.slug, scheduleIds, eventTypeIds };
}

// ---------------------------------------------------------------------------------------------------------------
// Team scenario

async function upsertTeam(tx: DbOrTx, organizationId: string): Promise<string> {
  const spec = TEAM_SCENARIO.team;
  const values = { name: spec.name, timezone: spec.timezone, welcomeMessage: spec.welcomeMessage, deletedAt: null };
  const [handle] = await tx.select().from(handles).where(eq(handles.slug, spec.slug)).limit(1);
  if (handle?.userId) throw new Error(`[seed] the handle "${spec.slug}" belongs to a user; reset the database first`);
  if (handle?.teamId) {
    const [team] = await tx.select().from(teams).where(eq(teams.id, handle.teamId)).limit(1);
    if (!team || team.organizationId !== organizationId) {
      throw new Error(`[seed] the team "${spec.slug}" belongs to another organization; reset the database first`);
    }
    await tx.update(teams).set(values).where(eq(teams.id, team.id));
    return team.id;
  }
  const [team] = await tx
    .insert(teams)
    .values({ organizationId, slug: spec.slug, ...values })
    .returning({ id: teams.id });
  if (!team) throw new Error("[seed] team insert returned no row");
  await claimHandle(tx, spec.slug, { teamId: team.id });
  return team.id;
}

/** The "team" scenario: owner plus two members and the team "Sales" with a round robin and a collective type. */
export async function seedTeam(tx: DbOrTx, owner: SeededOwner): Promise<SeededTeam> {
  const memberIds: Record<string, string> = {};
  const teamRoles: { userId: string; role: "manager" | "member" }[] = [{ userId: owner.userId, role: "manager" }];
  for (const m of TEAM_SCENARIO.members) {
    const { user } = await upsertAccount(tx, {
      name: m.name,
      email: m.email,
      password: m.password,
      timezone: m.timezone,
      slug: m.slug,
      isInstanceAdmin: false,
      organizationId: owner.organizationId,
      role: m.role,
    });
    memberIds[m.email] = user.id;
    teamRoles.push({ userId: user.id, role: m.teamRole });
  }

  const teamId = await upsertTeam(tx, owner.organizationId);
  for (const tr of teamRoles) {
    await tx
      .insert(teamMemberships)
      .values({ teamId, userId: tr.userId, role: tr.role })
      .onConflictDoUpdate({ target: [teamMemberships.teamId, teamMemberships.userId], set: { role: tr.role } });
  }

  const hostIds = teamRoles.map((t) => t.userId);
  const eventTypeIds: Record<string, string> = {};
  for (const spec of TEAM_SCENARIO.eventTypes) {
    const values = {
      name: spec.name,
      color: spec.color,
      durationMinutes: spec.durationMinutes,
      position: spec.position,
      locations: spec.locations,
      kind: "solo" as const,
      poolingType: spec.poolingType,
      scheduleId: null,
      availabilitySetting: "host" as const,
      organizerUserId: spec.poolingType === "collective" ? owner.userId : null,
      active: true,
      secret: false,
      locale: "en",
    };
    const [existing] = await tx
      .select({ id: eventTypes.id })
      .from(eventTypes)
      .where(and(eq(eventTypes.teamId, teamId), eq(eventTypes.slug, spec.slug), isNull(eventTypes.deletedAt)))
      .limit(1);
    let id: string;
    if (existing) {
      await tx.update(eventTypes).set(values).where(eq(eventTypes.id, existing.id));
      id = existing.id;
    } else {
      const [inserted] = await tx
        .insert(eventTypes)
        .values({
          organizationId: owner.organizationId,
          ownerUserId: null,
          teamId,
          scope: "team",
          type: "standard",
          slug: spec.slug,
          createdByUserId: owner.userId,
          ...values,
        })
        .returning({ id: eventTypes.id });
      if (!inserted) throw new Error("[seed] team event type insert returned no row");
      id = inserted.id;
    }

    let poolId: string | null = null;
    if (spec.poolingType === "round_robin") {
      const pools = await tx
        .select({ id: eventTypeHostPools.id })
        .from(eventTypeHostPools)
        .where(eq(eventTypeHostPools.eventTypeId, id))
        .orderBy(asc(eventTypeHostPools.position), asc(eventTypeHostPools.createdAt));
      if (pools[0]) {
        poolId = pools[0].id;
        await tx
          .update(eventTypeHostPools)
          .set({ name: "Pool 1", distribution: "availability", position: 0 })
          .where(eq(eventTypeHostPools.id, poolId));
        await tx
          .delete(eventTypeHostPools)
          .where(and(eq(eventTypeHostPools.eventTypeId, id), ne(eventTypeHostPools.id, poolId)));
      } else {
        const [pool] = await tx
          .insert(eventTypeHostPools)
          .values({ eventTypeId: id, name: "Pool 1", distribution: "availability", position: 0 })
          .returning({ id: eventTypeHostPools.id });
        if (!pool) throw new Error("[seed] pool insert returned no row");
        poolId = pool.id;
      }
    }
    await syncHosts(
      tx,
      id,
      hostIds.map((userId) => ({ userId, poolId })),
    );
    await syncQuestions(tx, id, [{ label: DEFAULT_QUESTION_LABEL, type: "text", required: false }]);
    eventTypeIds[spec.slug] = id;
  }
  return { teamId, slug: TEAM_SCENARIO.team.slug, memberIds, eventTypeIds };
}

// ---------------------------------------------------------------------------------------------------------------
// --demo extras

type EventTypeRow = typeof eventTypes.$inferSelect;

function snapshotFor(et: EventTypeRow): MeetingSettingsSnapshot {
  return {
    // CAL-12 "auto" resolves to email confirmations: the demo owner has no writable calendar connected.
    notificationMode: et.notificationType === "calendar_invitation" ? "calendar_invitation" : "email_confirmation",
    includeCancelRescheduleLinks: et.includeCancelRescheduleLinks,
    includeAnswersInNotifications: et.includeAnswersInNotifications,
    templates: et.notificationTemplates ?? {},
    cancellationPolicy: et.cancellationPolicy,
    locale: et.locale,
    timeZoneDisplay: et.timeZoneDisplay,
    lockedTimeZone: et.lockedTimeZone,
    color: et.color,
    afterBooking: et.afterBooking,
    redirectUrl: et.redirectUrl,
    redirectPassDetails: et.redirectPassDetails,
    scheduleAnotherEnabled: et.scheduleAnotherEnabled,
    scheduleAnotherLabel: et.scheduleAnotherLabel,
    confirmationLinks: et.confirmationLinks ?? [],
    changeCutoffMinutes: et.changeCutoffMinutes,
    requireCancelReason: et.requireCancelReason,
  };
}

/** The location a booking with this choice would resolve to (no provider calls: Google Meet needs a connection). */
function resolveDemoLocation(config: LocationConfig | undefined): ResolvedLocation {
  const base: ResolvedLocation = {
    configId: config?.id ?? null,
    kind: config?.kind ?? null,
    location: null,
    additionalInfo: null,
    joinUrl: null,
    status: null,
    providerMeetingId: null,
    password: null,
    dialIn: null,
    data: null,
    error: null,
  };
  if (!config) return base;
  if (config.kind === "physical" || config.kind === "custom" || config.kind === "ask_invitee") {
    return { ...base, location: config.location ?? null, additionalInfo: config.additionalInfo ?? null };
  }
  // Conferencing kinds: the demo owner has no Google connection, so the link cannot be created (honest state).
  return { ...base, status: "failed", error: "not_configured" };
}

/** First local date on or after `from` whose weekly hours contain [minutes, minutes + duration]. */
function firstFittingDate(from: string, weekly: WeeklyHours, minutes: number, duration: number, zone: string): string {
  let date = from;
  for (let i = 0; i < 14; i++) {
    const day = weekly[weekdayOf(date, zone)] ?? [];
    if (day.some((r) => r.end > r.start && r.start <= minutes && minutes + duration <= r.end)) return date;
    date = addDays(date, 1);
  }
  return from;
}

async function upsertDemoContact(tx: DbOrTx, owner: SeededOwner, c: (typeof DEMO_CONTACTS)[number]): Promise<string> {
  const emailNormalized = normalizeEmail(c.email);
  const values = {
    name: c.name,
    primaryEmail: c.email,
    company: c.company,
    jobTitle: c.jobTitle,
    timezone: c.timezone,
    lastInteractionAt: now(),
  };
  const [existing] = await tx
    .select({ contactId: contactEmails.contactId })
    .from(contactEmails)
    .where(
      and(
        eq(contactEmails.ownerUserId, owner.userId),
        eq(contactEmails.emailNormalized, emailNormalized),
        isNull(contactEmails.deletedAt),
      ),
    )
    .limit(1);
  if (existing) {
    await tx.update(contacts).set(values).where(eq(contacts.id, existing.contactId));
    return existing.contactId;
  }
  const [contact] = await tx
    .insert(contacts)
    .values({ ownerUserId: owner.userId, organizationId: owner.organizationId, creationSource: "booking", ...values })
    .returning({ id: contacts.id });
  if (!contact) throw new Error("[seed] contact insert returned no row");
  await tx.insert(contactEmails).values({
    contactId: contact.id,
    ownerUserId: owner.userId,
    email: c.email,
    emailNormalized,
    isPrimary: true,
  });
  return contact.id;
}

/** --demo: two contacts, a few meetings in the next two weeks, and the modules' seedDemo(). */
export async function seedDemoExtras(tx: DbOrTx, owner: SeededOwner): Promise<SeededDemo> {
  const contactIdByEmail = new Map<string, string>();
  for (const c of DEMO_CONTACTS) contactIdByEmail.set(normalizeEmail(c.email), await upsertDemoContact(tx, owner, c));

  const ownerEventTypes = await tx
    .select()
    .from(eventTypes)
    .where(inArray(eventTypes.id, Object.values(owner.eventTypeIds)));
  const bySlug = new Map(ownerEventTypes.map((et) => [et.slug, et]));
  const zone = OWNER.timezone;
  const today = localDateOf(now(), zone);
  const scheduledEventIds: string[] = [];
  const inviteeIds: string[] = [];
  const nextMeeting = new Map<string, Date>();

  for (const m of DEMO_MEETINGS) {
    const et = bySlug.get(m.eventTypeSlug);
    const etSpec = OWNER_EVENT_TYPES.find((e) => e.slug === m.eventTypeSlug);
    const schedule = OWNER_SCHEDULES.find((s) => s.key === etSpec?.schedule);
    if (!et || !etSpec || !schedule) throw new Error(`[seed] demo meeting ${m.key}: unknown event type ${m.eventTypeSlug}`);
    const [hh, mm] = m.time.split(":").map(Number);
    const minutes = (hh ?? 0) * 60 + (mm ?? 0);
    const date = firstFittingDate(addDays(today, m.daysFromNow), schedule.weeklyHours, minutes, et.durationMinutes, zone);
    const startAt = wallClockToUtc(date, minutes, zone);
    const endAt = new Date(startAt.getTime() + et.durationMinutes * 60_000);
    const bufferedStartAt = new Date(startAt.getTime() - et.bufferBeforeMinutes * 60_000);
    const bufferedEndAt = new Date(endAt.getTime() + et.bufferAfterMinutes * 60_000);
    const config = (et.locations ?? [])[m.locationIndex];
    const location = resolveDemoLocation(config);
    const contactId = contactIdByEmail.get(normalizeEmail(m.invitee.email)) ?? null;
    const question = await tx
      .select({ id: eventTypeQuestions.id, label: eventTypeQuestions.label, type: eventTypeQuestions.type })
      .from(eventTypeQuestions)
      .where(eq(eventTypeQuestions.eventTypeId, et.id))
      .orderBy(asc(eventTypeQuestions.position))
      .limit(1);
    const questionsAndAnswers: QuestionAnswer[] = question[0]
      ? [{ questionId: question[0].id, question: question[0].label, type: question[0].type, position: 0, answer: m.answer }]
      : [];
    const [firstName, ...rest] = m.invitee.name.split(" ");
    const inviteeValues = {
      eventTypeId: et.id,
      organizationId: owner.organizationId,
      email: m.invitee.email,
      emailNormalized: normalizeEmail(m.invitee.email),
      name: m.invitee.name,
      firstName: firstName ?? null,
      lastName: rest.join(" ") || null,
      timezone: m.invitee.timezone,
      detectedTimezone: m.invitee.timezone,
      timeFormat: "12h",
      locale: "en",
      status: "active" as const,
      questionsAndAnswers,
      locationAnswer: config ? { configId: config.id, value: null } : null,
      contactId,
      canceledAt: null,
      cancelReason: null,
      cancelerType: null,
    };
    const eventValues = {
      name: et.name,
      status: "active" as const,
      startAt,
      endAt,
      durationMinutes: et.durationMinutes,
      bufferBeforeMinutes: et.bufferBeforeMinutes,
      bufferAfterMinutes: et.bufferAfterMinutes,
      location,
      settingsSnapshot: snapshotFor(et),
      canceledAt: null,
      cancelReason: null,
      cancelerType: null,
    };
    const hostTimes = { startAt, endAt, bufferedStartAt, bufferedEndAt, isActive: true };

    const [existing] = await tx
      .select({ id: scheduledEvents.id })
      .from(scheduledEvents)
      .where(
        and(eq(scheduledEvents.organizerUserId, owner.userId), sql`${scheduledEvents.metadata}->>'seed' = ${m.key}`),
      )
      .limit(1);
    let scheduledEventId: string;
    let inviteeId: string;
    if (existing) {
      scheduledEventId = existing.id;
      await tx
        .update(scheduledEvents)
        .set({ ...eventValues, eventTypeId: et.id })
        .where(eq(scheduledEvents.id, scheduledEventId));
      await tx.update(scheduledEventHosts).set(hostTimes).where(eq(scheduledEventHosts.scheduledEventId, scheduledEventId));
      const [inv] = await tx
        .select({ id: invitees.id })
        .from(invitees)
        .where(eq(invitees.scheduledEventId, scheduledEventId))
        .orderBy(asc(invitees.createdAt))
        .limit(1);
      if (inv) {
        inviteeId = inv.id;
        await tx.update(invitees).set(inviteeValues).where(eq(invitees.id, inviteeId));
      } else {
        const [created] = await tx
          .insert(invitees)
          .values({ scheduledEventId, ...inviteeValues })
          .returning({ id: invitees.id });
        if (!created) throw new Error("[seed] invitee insert returned no row");
        inviteeId = created.id;
      }
    } else {
      scheduledEventId = newId();
      await tx.insert(scheduledEvents).values({
        id: scheduledEventId,
        organizationId: owner.organizationId,
        eventTypeId: et.id,
        isGroup: false,
        inviteesLimit: 1,
        organizerUserId: owner.userId,
        source: "booking_page",
        icsUid: `${scheduledEventId}@${appHost()}`,
        icsSequence: 0,
        provisionStatus: location.status === "failed" ? "partial" : "done",
        provisionedAt: now(),
        locale: "en",
        metadata: { seed: m.key },
        ...eventValues,
      });
      await tx.insert(scheduledEventHosts).values({
        scheduledEventId,
        userId: owner.userId,
        eventTypeId: et.id,
        poolId: null,
        role: "organizer",
        assignedAt: now(),
        ...hostTimes,
      });
      const [created] = await tx
        .insert(invitees)
        .values({ scheduledEventId, ...inviteeValues })
        .returning({ id: invitees.id });
      if (!created) throw new Error("[seed] invitee insert returned no row");
      inviteeId = created.id;
    }
    scheduledEventIds.push(scheduledEventId);
    inviteeIds.push(inviteeId);
    if (contactId) {
      const prev = nextMeeting.get(contactId);
      if (!prev || startAt < prev) nextMeeting.set(contactId, startAt);
    }
  }
  for (const [contactId, at] of nextMeeting) {
    await tx.update(contacts).set({ nextMeetingAt: at }).where(eq(contacts.id, contactId));
  }

  const ctx = {
    ownerUserId: owner.userId,
    organizationId: owner.organizationId,
    eventTypeIds: OWNER_EVENT_TYPES.map((e) => owner.eventTypeIds[e.slug]).filter((id): id is string => Boolean(id)),
  };
  await seedWorkflowsDemo(tx, ctx);
  await seedRoutingDemo(tx, ctx);
  await seedPollsDemo(tx, ctx);

  return { scheduledEventIds, inviteeIds, contactIds: [...contactIdByEmail.values()] };
}
