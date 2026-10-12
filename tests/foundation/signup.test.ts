// createUserAccount (ARCHITECTURE 18.4, SPEC AU-01, AU-13, ET-24, ET-33): every default an account starts with.
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  availabilitySchedules,
  domainEvents,
  eventTypeHosts,
  eventTypeQuestions,
  eventTypes,
  handles,
  organizationMemberships,
  organizations,
  users,
} from "@/db/schema";
import { createUserAccount, DEFAULT_QUESTION_LABEL } from "@/lib/auth/signup";
import { isAppError } from "@/lib/errors";
import { createOrg } from "../factories";
import { useTestDb } from "../helpers/db";

const t = useTestDb();

async function create(input: Parameters<typeof createUserAccount>[1]) {
  return t.db.transaction((tx) => createUserAccount(tx, input));
}

describe("createUserAccount (AU-13 defaults)", () => {
  it("creates the user, handle, workspace, owner membership, default schedule and default event type", async () => {
    const user = await create({ email: "  Julian.Joseph@Example.COM ", name: "Julian Joseph", timezone: "America/Los_Angeles" });

    expect(user.email).toBe("Julian.Joseph@Example.COM");
    expect(user.emailNormalized).toBe("julian.joseph@example.com");
    expect(user.name).toBe("Julian Joseph");
    expect(user.timezone).toBe("America/Los_Angeles");
    expect(user.locale).toBe("en");
    expect(user.slug).toBe("julian-joseph");
    expect(user.passwordHash).toBeNull();
    expect(user.isInstanceAdmin).toBe(false);

    const handleRows = await t.db.select().from(handles).where(eq(handles.userId, user.id));
    expect(handleRows.map((h) => h.slug)).toEqual(["julian-joseph"]);

    const memberships = await t.db
      .select({ role: organizationMemberships.role, orgName: organizations.name, orgId: organizations.id })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(eq(organizationMemberships.userId, user.id));
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ role: "owner", orgName: "Julian Joseph's workspace" });

    const schedules = await t.db.select().from(availabilitySchedules).where(eq(availabilitySchedules.userId, user.id));
    expect(schedules).toHaveLength(1);
    const schedule = schedules[0]!;
    expect(schedule).toMatchObject({ name: "Working hours", isDefault: true, timezone: "America/Los_Angeles", eventTypeId: null });
    const nineToFive = [{ start: 540, end: 1020 }];
    expect(schedule.weeklyHours).toEqual([[], nineToFive, nineToFive, nineToFive, nineToFive, nineToFive, []]);

    const types = await t.db.select().from(eventTypes).where(eq(eventTypes.ownerUserId, user.id));
    expect(types).toHaveLength(1);
    const et = types[0]!;
    expect(et).toMatchObject({
      organizationId: memberships[0]!.orgId,
      name: "30 Minute Meeting",
      slug: "30min",
      durationMinutes: 30,
      scope: "personal",
      type: "standard",
      kind: "solo",
      poolingType: null,
      bookingMethod: "instant",
      scheduleId: schedule.id,
      locations: [],
      position: 0,
      active: true,
      secret: false,
      locale: "en",
      // ET-33 defaults
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
      maxInvitees: 1,
      createdByUserId: user.id,
    });
    expect(et.color.toLowerCase()).toBe("#8247f5");

    const hosts = await t.db.select().from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, et.id));
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({ userId: user.id, poolId: null, scheduleId: null });

    const questions = await t.db.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, et.id));
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ label: DEFAULT_QUESTION_LABEL, type: "text", required: false, enabled: true, position: 0 });

    const events = await t.db.select().from(domainEvents).where(eq(domainEvents.type, "user.created"));
    expect(events.some((e) => (e.payload as { userId?: string }).userId === user.id)).toBe(true);
  });

  it("falls back to UTC for unknown zones and to the email for an empty name", async () => {
    const user = await create({ email: "nobody@example.com", name: "   ", timezone: "Mars/Olympus" });
    expect(user.timezone).toBe("UTC");
    expect(user.name).toBe("nobody");
    expect(user.slug).toBe("nobody");
    const [schedule] = await t.db.select().from(availabilitySchedules).where(eq(availabilitySchedules.userId, user.id));
    expect(schedule?.timezone).toBe("UTC");
  });

  it("de-duplicates handles with numeric suffixes and never takes a reserved word", async () => {
    const a = await create({ email: "sam1@example.com", name: "Sam Lee" });
    const b = await create({ email: "sam2@example.com", name: "Sam Lee" });
    const c = await create({ email: "admin@example.com", name: "Admin" });
    expect(a.slug).toBe("sam-lee");
    expect(b.slug).toBe("sam-lee2");
    expect(c.slug).toBe("admin2");
    const preferred = await create({ email: "pref@example.com", name: "Someone", slug: "julianjoseph" });
    expect(preferred.slug).toBe("julianjoseph");
  });

  it("rejects an email that already has a live account, without aborting the transaction", async () => {
    await create({ email: "dupe@example.com", name: "First" });
    const err = await t.db
      .transaction(async (tx) => {
        try {
          await createUserAccount(tx, { email: "DUPE@example.com", name: "Second" });
          return null;
        } catch (e) {
          // the transaction is still usable after the conflict
          await tx.select().from(users).limit(1);
          return e;
        }
      })
      .catch((e: unknown) => e);
    expect(isAppError(err) && err.code === "conflict").toBe(true);
    expect((err as { fieldErrors?: Record<string, string[]> }).fieldErrors?.email?.[0]).toBe(
      "An account with this email already exists. Log in instead.",
    );
  });

  it("joins an existing organization with the given role (invitations) and creates no new organization", async () => {
    const org = await createOrg(t.db, { name: "Acme" });
    const before = await t.db.select({ id: organizations.id }).from(organizations);
    const user = await create({ email: "member@example.com", name: "Member", organizationId: org.id, role: "admin" });
    const after = await t.db.select({ id: organizations.id }).from(organizations);
    expect(after).toHaveLength(before.length);
    const [m] = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, user.id));
    expect(m).toMatchObject({ organizationId: org.id, role: "admin" });
    const [et] = await t.db.select().from(eventTypes).where(eq(eventTypes.ownerUserId, user.id));
    expect(et?.organizationId).toBe(org.id);
  });

  it("uses Google Meet for Google signups and stores provider details", async () => {
    const verifiedAt = new Date("2026-10-01T00:00:00Z");
    const user = await create({
      email: "g@example.com",
      name: "Gee",
      defaultEventLocationKind: "google_conference",
      avatarUrl: "https://lh3.googleusercontent.com/a/x",
      emailVerifiedAt: verifiedAt,
      passwordHash: null,
      isInstanceAdmin: true,
      locale: "fr",
    });
    expect(user.avatarUrl).toBe("https://lh3.googleusercontent.com/a/x");
    expect(user.emailVerifiedAt?.toISOString()).toBe(verifiedAt.toISOString());
    expect(user.isInstanceAdmin).toBe(true);
    expect(user.locale).toBe("fr");
    const [et] = await t.db
      .select()
      .from(eventTypes)
      .where(and(eq(eventTypes.ownerUserId, user.id), eq(eventTypes.slug, "30min")));
    expect(et?.locations).toHaveLength(1);
    expect(et?.locations[0]).toMatchObject({ kind: "google_conference", position: 0 });
    expect(et?.locale).toBe("fr");
  });
});
