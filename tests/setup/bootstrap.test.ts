// Owner bootstrap service (src/lib/setup/bootstrap.ts) on PGlite: fresh bootstrap with the full Calendly snapshot,
// idempotent reruns that never overwrite edits, the refusal when another account exists, OWNER_EMAIL, an existing
// account (pristine, edited, or unverified), and the CLI wrapper.
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const schema = await import("@/db/schema");
const {
  auditLog,
  authTokens,
  availabilityDateOverrides,
  availabilitySchedules,
  eventTypeHosts,
  eventTypeQuestions,
  eventTypes,
  handles,
  instanceSettings,
  organizations,
  sessions,
  users,
  workflows,
  workflowSteps,
} = schema;
const { bootstrapOwner, OTHER_ACCOUNT_MESSAGE, SNAPSHOT_MARKER_KEY, UNVERIFIED_ACCOUNT_MESSAGE } = await import("@/lib/setup/bootstrap");
const { loadActorCtx } = await import("@/lib/authz");
const { saveEventTypeReminders } = await import("@/lib/workflows");
const { SaveRemindersSchema } = await import("@/lib/workflows/schemas");
const { OWNER_EMAIL_MISMATCH_MESSAGE } = await import("@/lib/setup/config");
const { OWNER_SNAPSHOT } = await import("@/lib/setup/owner-snapshot");
const { createUserAccount, DEFAULT_EVENT_TYPE } = await import("@/lib/auth/signup");
const { createSessionRecord, lookupSession } = await import("@/lib/auth/session");
const { hashPassword } = await import("@/lib/crypto");
const { withTx } = await import("@/db");
const { parseBootstrapArgs, runBootstrapCli } = await import("../../scripts/bootstrap-owner.ts");
const { useTestDb } = await import("../helpers/db");
const { createEventType, createUser } = await import("../factories");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const OWNER = "julian@example.com";

beforeEach(async () => {
  delete env.OWNER_EMAIL;
  await t.db.delete(users);
  await t.db.delete(organizations);
  await t.db.delete(handles);
  await t.db.delete(instanceSettings);
  await t.db.delete(auditLog);
});
afterEach(() => {
  delete env.OWNER_EMAIL;
});

const r = (from: string, to: string) => {
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  return { start: m(from), end: m(to) };
};

async function ownerRow() {
  const [u] = await t.db.select().from(users).where(eq(users.emailNormalized, OWNER));
  if (!u) throw new Error("owner missing");
  return u;
}

async function liveEventTypes(userId: string) {
  return t.db
    .select()
    .from(eventTypes)
    .where(and(eq(eventTypes.ownerUserId, userId), isNull(eventTypes.deletedAt)))
    .orderBy(asc(eventTypes.position));
}

async function counts(userId: string) {
  const [types, schedules, reminders, allUsers] = await Promise.all([
    t.db.select({ id: eventTypes.id }).from(eventTypes).where(eq(eventTypes.ownerUserId, userId)),
    t.db.select({ id: availabilitySchedules.id }).from(availabilitySchedules).where(eq(availabilitySchedules.userId, userId)),
    t.db.select({ id: workflows.id }).from(workflows).where(eq(workflows.ownerUserId, userId)),
    t.db.select({ id: users.id }).from(users),
  ]);
  return { types: types.length, schedules: schedules.length, reminders: reminders.length, users: allUsers.length };
}

describe("fresh bootstrap", () => {
  it("creates the verified, passwordless instance admin and applies the owner's whole Calendly setup", async () => {
    const result = await bootstrapOwner({ email: "  Julian@Example.com ", avatarUrl: "https://lh3.googleusercontent.com/a/owner" }, { db: t.db });
    expect(result.account).toBe("created");
    expect(result.snapshot.status).toBe("applied");
    expect(result.user).toMatchObject({
      email: "Julian@Example.com",
      name: "Julian Joseph",
      slug: "julianjoseph",
      timezone: "America/Los_Angeles",
      isInstanceAdmin: true,
      emailVerified: true,
      hasPassword: false,
      avatarUrl: "https://lh3.googleusercontent.com/a/owner",
    });
    expect(result.links).toEqual({
      profile: "http://localhost:3000/julianjoseph",
      login: "http://localhost:3000/login",
      scheduling: "http://localhost:3000/app/scheduling",
    });
    expect(result.changes.length).toBeGreaterThanOrEqual(5);
    expect(result.changes.join("\n")).not.toMatch(/[\u2013\u2014]/);

    const u = await ownerRow();
    expect(u).toMatchObject({
      name: "Julian Joseph",
      slug: "julianjoseph",
      timezone: "America/Los_Angeles",
      timeFormat: "12h",
      locale: "en",
      welcomeMessage: "Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.",
      isInstanceAdmin: true,
      passwordHash: null,
    });
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(u.onboardingCompletedAt).not.toBeNull();
    expect((u.metadata as Record<string, { snapshotVersion: number }>)[SNAPSHOT_MARKER_KEY]?.snapshotVersion).toBe(OWNER_SNAPSHOT.version);
    const [handle] = await t.db.select().from(handles).where(eq(handles.userId, u.id));
    expect(handle?.slug).toBe("julianjoseph");

    // Schedules: Working hours (default) and Block Off Work, both in Los Angeles, with the observed hours.
    const schedules = await t.db
      .select()
      .from(availabilitySchedules)
      .where(eq(availabilitySchedules.userId, u.id))
      .orderBy(asc(availabilitySchedules.createdAt));
    expect(schedules.map((s) => [s.name, s.isDefault, s.timezone])).toEqual([
      ["Working hours", true, "America/Los_Angeles"],
      ["Block Off Work", false, "America/Los_Angeles"],
    ]);
    const [working, blockOff] = schedules;
    expect(working!.weeklyHours).toEqual([
      [r("14:00", "19:00")],
      [r("12:00", "17:00")],
      [r("11:00", "23:00")],
      [r("11:00", "23:00")],
      [r("11:00", "20:00")],
      [r("11:00", "17:00")],
      [],
    ]);
    expect(blockOff!.weeklyHours).toEqual([[r("13:00", "21:00")], [], [r("17:00", "20:00")], [r("17:00", "20:00")], [r("17:00", "20:00")], [], []]);
    expect(await t.db.select().from(availabilityDateOverrides)).toHaveLength(0);

    // Event types in order, replacing the signup default.
    const types = await liveEventTypes(u.id);
    expect(types.map((e) => [e.position, e.name, e.slug, e.durationMinutes, e.color])).toEqual([
      [0, "30 Minute Virtual", "30min", 30, "#8247f5"],
      [1, "60 Minute Virtual", "60min", 60, "#8247f5"],
      [2, "In-Person Meal or Coffee", "meal", 120, "#17e885"],
    ]);
    expect(types.some((e) => e.name === DEFAULT_EVENT_TYPE.name)).toBe(false);
    expect(await t.db.select().from(eventTypes).where(eq(eventTypes.ownerUserId, u.id))).toHaveLength(3);
    const [thirty, sixty, meal] = types;
    expect(thirty!.scheduleId).toBe(working!.id);
    expect(sixty!.scheduleId).toBe(working!.id);
    expect(meal!.scheduleId).toBe(blockOff!.id);
    for (const et of types) {
      expect(et).toMatchObject({
        kind: "solo",
        type: "standard",
        scope: "personal",
        active: true,
        secret: false,
        slotIncrementMinutes: 15,
        minimumNoticeMinutes: 240,
        dateRangeType: "rolling",
        dateRangeDays: 60,
        dateRangeMode: "calendar_days",
        limitPerDay: null,
        limitPerWeek: null,
        limitPerMonth: null,
        allowGuests: true,
        autofillInvitee: true,
        nameFormat: "full",
        maxInvitees: 1,
        afterBooking: "confirmation_page",
        scheduleAnotherEnabled: true,
        locale: "en",
      });
      const hosts = await t.db.select().from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, et.id));
      expect(hosts.map((h) => h.userId)).toEqual([u.id]);
      const questions = await t.db.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, et.id));
      expect(questions.map((q) => ({ label: q.label, type: q.type, required: q.required, enabled: q.enabled }))).toEqual([
        { label: "What would you like to discuss?", type: "text", required: true, enabled: true },
      ]);
    }
    expect([thirty!.bufferBeforeMinutes, thirty!.bufferAfterMinutes]).toEqual([15, 15]);
    expect([sixty!.bufferBeforeMinutes, sixty!.bufferAfterMinutes]).toEqual([15, 15]);
    expect([meal!.bufferBeforeMinutes, meal!.bufferAfterMinutes]).toEqual([0, 0]);
    expect(thirty!.locations.map((l) => l.kind)).toEqual(["google_conference"]);
    expect(sixty!.locations.map((l) => l.kind)).toEqual(["google_conference"]);
    expect(meal!.locations.map((l) => [l.position, l.kind, l.location ?? null, l.additionalInfo ?? null])).toEqual([
      [0, "physical", "Tribute Pizza - North Park - $$$", "3077 N Park Way, San Diego, CA 92104"],
      [1, "physical", "Best Pizza & Brew - Mira Mesa - $", "9172 Mira Mesa Blvd, San Diego, CA 92126"],
      [2, "physical", "The Reading Club - Embarcadero - $$$\n[Business Casual Dress Code]", "901 Bayfront Court San Diego, CA 92101"],
      [3, "physical", "Tavola Nostra - Hillcrest - $$", "1040 University Ave B101, San Diego, CA 92103"],
      [4, "physical", "Bronx Pizza - Hillcrest - $", "111 Washington St, San Diego, CA 92103"],
      [5, "physical", "Paradis Coffee - Mission Hills - $", "901 W Washington St, San Diego, CA 92103"],
      [6, "physical", "Cardellino - Mission Hills - $$$", "4033 Goldfinch St, San Diego, CA 92103"],
      [7, "physical", "Finjan Coffee - Convoy - $", "9119 Clairemont Mesa Blvd g, San Diego, CA 92123"],
      [8, "ask_invitee", null, null],
    ]);
    expect(new Set(meal!.locations.map((l) => l.id)).size).toBe(9);

    // The default email reminder to invitees, 24 hours before, on every event type.
    const reminderRows = await t.db
      .select({ workflow: workflows, step: workflowSteps })
      .from(workflows)
      .innerJoin(workflowSteps, eq(workflowSteps.workflowId, workflows.id))
      .where(eq(workflows.ownerUserId, u.id));
    expect(reminderRows).toHaveLength(3);
    expect(new Set(reminderRows.map((x) => x.workflow.basicEventTypeId))).toEqual(new Set(types.map((e) => e.id)));
    for (const x of reminderRows) {
      expect(x.workflow).toMatchObject({ isBasic: true, basicKind: "email_reminder", trigger: "before_start", offsetMinutes: 1440, active: true });
      expect(x.step).toMatchObject({ action: "email_invitees", includeCancelRescheduleLinks: true });
    }
    expect(result.snapshot.status === "applied" && result.snapshot.reminders).toBe(3);
    if (result.snapshot.status === "applied") {
      expect(result.snapshot.eventTypes.map((e) => e.url)).toEqual([
        "http://localhost:3000/julianjoseph/30min",
        "http://localhost:3000/julianjoseph/60min",
        "http://localhost:3000/julianjoseph/meal",
      ]);
      expect(result.snapshot.scheduleIds).toEqual({ working_hours: working!.id, block_off_work: blockOff!.id });
    }

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.targetId, u.id));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["user.signup", "instance.owner_bootstrap"]));
    const signup = audits.find((a) => a.action === "user.signup");
    expect(signup?.details).toMatchObject({ method: "owner_bootstrap" });
  });

  it("uses the given name instead of the snapshot's", async () => {
    const result = await bootstrapOwner({ email: OWNER, name: "  Julian   J. " }, { db: t.db });
    expect(result.user.name).toBe("Julian J.");
    expect((await ownerRow()).name).toBe("Julian J.");
  });
});

describe("idempotent reruns", () => {
  it("reports the existing setup without duplicating anything", async () => {
    await bootstrapOwner({ email: OWNER }, { db: t.db });
    const u = await ownerRow();
    const before = await counts(u.id);
    expect(before).toEqual({ types: 3, schedules: 2, reminders: 3, users: 1 });

    const again = await bootstrapOwner({ email: OWNER }, { db: t.db });
    expect(again.account).toBe("existing");
    expect(again.snapshot).toMatchObject({ status: "skipped", reason: "already_applied" });
    expect(again.changes).toEqual([
      "The account already exists with a verified email and instance admin rights.",
      "Skipped the Calendly setup: the Calendly setup was already applied to this account.",
    ]);
    expect(await counts(u.id)).toEqual(before);
  });

  it("never overwrites later edits, even when the marker is gone", async () => {
    await bootstrapOwner({ email: OWNER }, { db: t.db });
    const u = await ownerRow();
    const [thirty] = await liveEventTypes(u.id);
    await t.db.update(eventTypes).set({ name: "Quick chat", bufferAfterMinutes: 0, updatedAt: new Date() }).where(eq(eventTypes.id, thirty!.id));
    await t.db.update(users).set({ metadata: {}, welcomeMessage: "Hi there" }).where(eq(users.id, u.id));

    const again = await bootstrapOwner({ email: OWNER }, { db: t.db });
    expect(again.snapshot).toMatchObject({ status: "skipped", reason: "has_event_types" });
    const [after] = await liveEventTypes(u.id);
    expect(after).toMatchObject({ id: thirty!.id, name: "Quick chat", bufferAfterMinutes: 0 });
    expect((await ownerRow()).welcomeMessage).toBe("Hi there");
    expect(await counts(u.id)).toMatchObject({ types: 3, schedules: 2, reminders: 3 });
  });
});

describe("refusals", () => {
  it("refuses with 409 when another account exists, and writes nothing", async () => {
    await createUser(t.db, { email: "someone@example.com" });
    await expect(bootstrapOwner({ email: OWNER }, { db: t.db })).rejects.toMatchObject({ code: "conflict", status: 409, message: OTHER_ACCOUNT_MESSAGE });
    expect(await t.db.select().from(users).where(eq(users.emailNormalized, OWNER))).toHaveLength(0);
  });

  it("refuses with 409 after another account appeared next to the bootstrapped owner", async () => {
    await bootstrapOwner({ email: OWNER }, { db: t.db });
    await createUser(t.db, { email: "intruder@example.com" });
    await expect(bootstrapOwner({ email: OWNER }, { db: t.db })).rejects.toMatchObject({ code: "conflict" });
  });

  it("ignores deleted accounts", async () => {
    await createUser(t.db, { email: "gone@example.com", withoutHandle: true, overrides: { deletedAt: new Date(), slug: null } });
    const result = await bootstrapOwner({ email: OWNER }, { db: t.db });
    expect(result.account).toBe("created");
  });

  it("only accepts OWNER_EMAIL when it is set (case and spaces do not matter)", async () => {
    env.OWNER_EMAIL = " JULIAN@example.com ";
    await expect(bootstrapOwner({ email: "other@example.com" }, { db: t.db })).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
      message: OWNER_EMAIL_MISMATCH_MESSAGE,
    });
    expect(await t.db.select().from(users)).toHaveLength(0);
    const ok = await bootstrapOwner({ email: OWNER }, { db: t.db });
    expect(ok.account).toBe("created");
  });

  it("refuses everything while OWNER_EMAIL is malformed", async () => {
    env.OWNER_EMAIL = "not-an-email";
    await expect(bootstrapOwner({ email: OWNER }, { db: t.db })).rejects.toMatchObject({ code: "not_configured" });
  });

  it("validates the input", async () => {
    await expect(bootstrapOwner({ email: "nope" }, { db: t.db })).rejects.toMatchObject({ code: "validation", fieldErrors: { email: expect.any(Array) } });
    await expect(bootstrapOwner({ email: OWNER, avatarUrl: "http://example.com/a.png" }, { db: t.db })).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { avatarUrl: ["Enter an https link to an image."] },
    });
    await expect(bootstrapOwner({ email: OWNER, name: "   " }, { db: t.db })).rejects.toMatchObject({ code: "validation", fieldErrors: { name: expect.any(Array) } });
    expect(await t.db.select().from(users)).toHaveLength(0);
  });
});

describe("existing owner account", () => {
  it("applies the snapshot to an untouched account (for example a Google sign-in before the bootstrap)", async () => {
    const created = await withTx(t.db, (tx) =>
      createUserAccount(tx, {
        email: OWNER,
        name: "Julian From Google",
        timezone: "America/Chicago",
        emailVerifiedAt: new Date(),
        isInstanceAdmin: true,
        avatarUrl: "https://lh3.googleusercontent.com/a/google",
        defaultEventLocationKind: "google_conference",
      }),
    );
    const result = await bootstrapOwner({ email: OWNER, avatarUrl: "https://example.com/other.png" }, { db: t.db });
    expect(result.account).toBe("existing");
    expect(result.snapshot.status).toBe("applied");
    const u = await ownerRow();
    expect(u).toMatchObject({ id: created.id, name: "Julian Joseph", slug: "julianjoseph", timezone: "America/Los_Angeles" });
    // The picture the account already had is kept.
    expect(u.avatarUrl).toBe("https://lh3.googleusercontent.com/a/google");
    const types = await liveEventTypes(u.id);
    expect(types.map((e) => e.slug)).toEqual(["30min", "60min", "meal"]);
    expect(await t.db.select().from(eventTypes).where(eq(eventTypes.ownerUserId, u.id))).toHaveLength(3);
    const schedules = await t.db.select().from(availabilitySchedules).where(eq(availabilitySchedules.userId, u.id));
    expect(schedules.find((s) => s.isDefault)).toMatchObject({ name: "Working hours", timezone: "America/Los_Angeles" });
  });

  it("skips the snapshot for an account that already has its own event types, and still makes it instance admin", async () => {
    const existing = await createUser(t.db, { email: OWNER, isInstanceAdmin: false });
    await createEventType(t.db, { owner: existing, name: "My call", slug: "call" });
    const result = await bootstrapOwner({ email: OWNER, avatarUrl: "https://example.com/me.png" }, { db: t.db });
    expect(result.snapshot).toMatchObject({ status: "skipped", reason: "has_event_types" });
    const u = await ownerRow();
    expect(u.isInstanceAdmin).toBe(true);
    expect(u.avatarUrl).toBe("https://example.com/me.png");
    expect((await liveEventTypes(u.id)).map((e) => e.slug)).toEqual(["call"]);
    expect(result.changes).toContain("Made the existing account an instance admin.");
  });

  it("skips the snapshot when the default event type is untouched but the availability was changed", async () => {
    const created = await withTx(t.db, (tx) => createUserAccount(tx, { email: OWNER, name: "Julian", emailVerifiedAt: new Date() }));
    await t.db.update(availabilitySchedules).set({ weeklyHours: [[], [], [], [], [], [], []], updatedAt: new Date() }).where(eq(availabilitySchedules.userId, created.id));
    const result = await bootstrapOwner({ email: OWNER }, { db: t.db });
    expect(result.snapshot).toMatchObject({ status: "skipped", reason: "has_schedules" });
    expect((await liveEventTypes(created.id)).map((e) => e.name)).toEqual([DEFAULT_EVENT_TYPE.name]);
  });

  it("refuses (409) an account whose email was never verified, and changes nothing", async () => {
    // A squatter's email signup with the owner's address: as the first account it was instance admin and may have left
    // ways back in (a linked sign-in method, an invitation, a calendar) that no password reset removes.
    const squatter = await createUser(t.db, {
      email: OWNER,
      passwordHash: await hashPassword("pw-123456"),
      overrides: { emailVerifiedAt: null, twoFactorEnabled: true, twoFactorSecretEnc: "v1.x.y.z" },
    });
    const session = await createSessionRecord(t.db, squatter.id);
    await t.db.insert(authTokens).values({ userId: squatter.id, purpose: "email_change", tokenHash: "h".repeat(64), expiresAt: new Date(Date.now() + 3_600_000) });
    const before = await ownerRow();

    await expect(bootstrapOwner({ email: OWNER }, { db: t.db })).rejects.toMatchObject({ code: "conflict", status: 409, message: UNVERIFIED_ACCOUNT_MESSAGE });
    const u = await ownerRow();
    expect(u).toMatchObject({ emailVerifiedAt: null, passwordHash: before.passwordHash, isInstanceAdmin: before.isInstanceAdmin, metadata: before.metadata });
    expect(await lookupSession(t.db, session.token)).not.toBeNull();
    expect(await liveEventTypes(u.id)).toHaveLength(0);
    expect(await t.db.select().from(auditLog).where(eq(auditLog.action, "instance.owner_bootstrap"))).toHaveLength(0);
    const live = (await t.db.select().from(sessions).where(eq(sessions.userId, squatter.id))).filter((s) => !s.revokedAt);
    expect(live).toHaveLength(1);
  });

  it("skips the snapshot when the untouched default event type has reminders of its own", async () => {
    const created = await withTx(t.db, (tx) => createUserAccount(tx, { email: OWNER, name: "Julian", emailVerifiedAt: new Date() }));
    const [defaultType] = await liveEventTypes(created.id);
    const actor = await loadActorCtx(t.db, created);
    // The editor's Notifications section saves reminders on its own, without updating the event type row.
    await saveEventTypeReminders(
      actor,
      SaveRemindersSchema.parse({
        eventTypeId: defaultType!.id,
        kind: "invitee",
        enabled: true,
        timings: [{ amount: 2, unit: "hours" }],
        subject: null,
        bodyHtml: null,
        includeCancelRescheduleLinks: true,
      }),
      t.db,
    );
    const [afterReminder] = await liveEventTypes(created.id);
    expect(afterReminder!.updatedAt.getTime()).toBe(afterReminder!.createdAt.getTime());

    const result = await bootstrapOwner({ email: OWNER }, { db: t.db });
    expect(result.snapshot).toMatchObject({ status: "skipped", reason: "has_event_types" });
    expect((await liveEventTypes(created.id)).map((e) => e.id)).toEqual([defaultType!.id]);
    const kept = await t.db.select().from(workflows).where(eq(workflows.basicEventTypeId, defaultType!.id));
    expect(kept.map((w) => w.offsetMinutes)).toEqual([120]);
  });
});

describe("CLI (scripts/bootstrap-owner.ts)", () => {
  it("parses its flags", () => {
    expect(parseBootstrapArgs(["--", "--email=a@example.com", "--name", "Julian Joseph", "--avatar-url=https://x.example/a.png"])).toEqual({
      email: "a@example.com",
      name: "Julian Joseph",
      avatarUrl: "https://x.example/a.png",
      help: false,
    });
    expect(parseBootstrapArgs(["--help"])).toMatchObject({ help: true });
    expect(() => parseBootstrapArgs([])).toThrow(/--email is required/);
    expect(() => parseBootstrapArgs(["--email"])).toThrow(/needs a value/);
    expect(() => parseBootstrapArgs(["--email=a@example.com", "--email=b@example.com"])).toThrow(/twice/);
    expect(() => parseBootstrapArgs(["--password=x"])).toThrow(/Unknown argument/);
  });

  it("runs the same bootstrap and prints what it did", async () => {
    const first = await runBootstrapCli({ email: OWNER }, { db: t.db });
    expect(first.result.account).toBe("created");
    expect(first.summary).toContain("Created the owner account julian@example.com");
    expect(first.summary).toContain("http://localhost:3000/julianjoseph/meal");
    expect(first.summary).toContain('choose "Continue with Google"');
    const second = await runBootstrapCli({ email: OWNER }, { db: t.db });
    expect(second.summary).toContain("Skipped the Calendly setup");
  });
});
