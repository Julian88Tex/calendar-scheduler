// Email signup end to end without a browser (SPEC AU-01, AU-08, AU-11, AU-13, AU-14, GEN-17): the step 1 check, the
// signUp action (account with every AU-13 default, session cookie, Scheduling), welcome and verification emails in
// the outbox, the audit entry, the closed and taken messages, and 20 signups per IP per hour.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);
vi.mock("next/cache", async () => (await import("./_request")).nextCacheMock);

const { auditLog, availabilitySchedules, emailOutbox, eventTypes, instanceSettings, organizations, rateLimitBuckets, sessions, users } =
  await import("@/db/schema");
const { checkSignupEmail, signUp } = await import("@/app/(auth)/signup/actions");
const { SESSION_COOKIE, lookupSession } = await import("@/lib/auth/session");
const { useTestDb } = await import("../helpers/db");
const { expectRedirect, form, jar, resetRequest } = await import("./_request");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;

async function wipe() {
  await t.db.delete(users);
  await t.db.delete(organizations);
  await t.db.delete(instanceSettings);
  await t.db.delete(rateLimitBuckets);
  await t.db.delete(emailOutbox);
}

beforeEach(async () => {
  delete env.SIGNUP_POLICY;
  resetRequest({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}` });
  await wipe();
});

const details = (email: string, extra: Record<string, string> = {}) =>
  form({ email, name: "Ada Lovelace", password: "analytical1", timezone: "Europe/London", ...extra });

describe("step 1: checkSignupEmail", () => {
  it("accepts a new address on a fresh instance", async () => {
    const res = await checkSignupEmail({ email: " Ada@Example.com " });
    expect(res).toEqual({ ok: true, data: { email: "Ada@Example.com" } });
  });

  it("rejects an invalid address with a field error", async () => {
    const res = await checkSignupEmail({ email: "not-an-email" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.fieldErrors?.email?.[0]).toBe("Enter a valid email address");
  });

  it("says when the email is taken and when signups are closed", async () => {
    await expectRedirect(signUp(null, details("ada@example.com")));
    resetRequest();
    const taken = await checkSignupEmail({ email: "ADA@example.com" });
    expect(taken.ok).toBe(false);
    if (!taken.ok) {
      expect(taken.error.code).toBe("conflict");
      expect(taken.error.message).toBe("An account with this email already exists. Log in instead.");
    }
    const closed = await checkSignupEmail({ email: "grace@example.com" });
    expect(closed.ok).toBe(false);
    if (!closed.ok) {
      expect(closed.error.code).toBe("forbidden");
      expect(closed.error.message).toBe("Sign ups are closed. Ask an admin for an invitation.");
    }
  });
});

describe("step 2: signUp", () => {
  it("creates the account with the AU-13 defaults, a session and lands on Scheduling", async () => {
    const target = await expectRedirect(signUp(null, details("Ada@Example.com")));
    expect(target).toBe("/app/scheduling");

    const [user] = await t.db.select().from(users).where(eq(users.emailNormalized, "ada@example.com"));
    expect(user).toMatchObject({ email: "Ada@Example.com", name: "Ada Lovelace", timezone: "Europe/London", isInstanceAdmin: true, slug: "ada-lovelace" });
    expect(user!.passwordHash).toMatch(/^scrypt\$/);
    expect(user!.emailVerifiedAt).toBeNull();

    const schedules = await t.db.select().from(availabilitySchedules).where(eq(availabilitySchedules.userId, user!.id));
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({ name: "Working hours", isDefault: true, timezone: "Europe/London" });
    const types = await t.db.select().from(eventTypes).where(eq(eventTypes.ownerUserId, user!.id));
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ name: "30 Minute Meeting", slug: "30min", durationMinutes: 30, locations: [], scheduleId: schedules[0]!.id });
    const [org] = await t.db.select().from(organizations);
    expect(org?.name).toBe("Ada Lovelace's workspace");

    const token = jar.get(SESSION_COOKIE);
    expect(token).toBeTruthy();
    const session = await lookupSession(t.db, token);
    expect(session?.user.id).toBe(user!.id);
    expect(session?.session.twoFactorPending).toBe(false);

    const mail = await t.db.select().from(emailOutbox).where(eq(emailOutbox.relatedUserId, user!.id));
    expect(mail.map((m) => m.template).sort()).toEqual(["auth.verify_email", "auth.welcome"]);
    const verify = mail.find((m) => m.template === "auth.verify_email")!;
    expect(verify.subject).toBe("Verify your email");
    expect(verify.toAddresses).toEqual(["Ada@Example.com"]);
    expect(verify.category).toBe("auth");
    expect(verify.html).toMatch(/http:\/\/localhost:3000\/verify-email\/[A-Za-z0-9_-]{43}/);

    const entries = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.signup"), eq(auditLog.targetId, user!.id)));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ namespace: "auth", actorUserId: user!.id, ip: expect.any(String) });
  });

  it("validates name and password (AU-01 rule) with field errors", async () => {
    const res = await signUp(null, form({ email: "ada@example.com", name: " ", password: "short" }));
    expect(res?.ok).toBe(false);
    if (res && !res.ok) {
      expect(res.error.fieldErrors?.name?.[0]).toBe("Enter your full name");
      expect(res.error.fieldErrors?.password?.[0]).toBe("Use at least 8 characters");
    }
    const noDigit = await signUp(null, details("ada@example.com", { password: "lettersonly" }));
    if (noDigit && !noDigit.ok) expect(noDigit.error.fieldErrors?.password?.[0]).toBe("Use at least one letter and one number");
    expect(await t.db.select().from(users)).toHaveLength(0);
  });

  it("closes signups after the first account (invite_only) and reports taken emails", async () => {
    await expectRedirect(signUp(null, details("first@example.com")));
    resetRequest();
    const closed = await signUp(null, details("second@example.com"));
    expect(closed).toMatchObject({ ok: false, error: { code: "forbidden", message: "Sign ups are closed. Ask an admin for an invitation." } });
    env.SIGNUP_POLICY = "open";
    const taken = await signUp(null, details("FIRST@example.com"));
    expect(taken).toMatchObject({ ok: false, error: { code: "conflict", message: "An account with this email already exists. Log in instead." } });
    const second = await expectRedirect(signUp(null, details("second@example.com")));
    expect(second).toBe("/app/scheduling");
    const [u2] = await t.db.select().from(users).where(eq(users.emailNormalized, "second@example.com"));
    expect(u2?.isInstanceAdmin).toBe(false);
    delete env.SIGNUP_POLICY;
  });

  it("allows 20 signups per IP per hour and rejects the 21st (AU-14)", async () => {
    env.SIGNUP_POLICY = "open";
    resetRequest({ "x-forwarded-for": "192.0.2.44" });
    // Every valid attempt counts: the first creates the account, the next 19 hit the taken email.
    await expectRedirect(signUp(null, details("u0@example.com")));
    for (let i = 1; i < 20; i++) {
      expect(await signUp(null, details("u0@example.com"))).toMatchObject({ ok: false, error: { code: "conflict" } });
    }
    const limited = await signUp(null, details("fresh@example.com"));
    expect(limited).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    if (limited && !limited.ok) expect(limited.error.message).toMatch(/^Too many attempts\. Try again in \d+ minutes?\.$/);
    delete env.SIGNUP_POLICY;
  });

  it("revokes a previous session of the browser", async () => {
    env.SIGNUP_POLICY = "open";
    await expectRedirect(signUp(null, details("one@example.com")));
    const firstToken = jar.get(SESSION_COOKIE)!;
    await expectRedirect(signUp(null, details("two@example.com")));
    expect(await lookupSession(t.db, firstToken)).toBeNull();
    const live = await t.db.select().from(sessions);
    expect(live.filter((s) => !s.revokedAt)).toHaveLength(1);
    delete env.SIGNUP_POLICY;
  });
});
