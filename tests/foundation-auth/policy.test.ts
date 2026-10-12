// Signup policy matrix (SPEC AU-11): first user, invite_only, open, domains, SIGNUP_POLICY override, ADMIN_EMAILS, and
// createAccountUnderPolicy (first account is instance admin, domains joins the first organization, invitations bypass).
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { instanceSettings, organizationMemberships, organizations, users } from "@/db/schema";
import { getSignupAvailability, getSignupPolicy, signupPolicyAllows, SIGNUPS_CLOSED_MESSAGE } from "@/lib/auth/policy";
import { createAccountUnderPolicy, EMAIL_TAKEN_MESSAGE } from "@/lib/auth/signup";
import { isAppError } from "@/lib/errors";
import { useTestDb } from "../helpers/db";

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;

async function wipe() {
  await t.db.delete(users);
  await t.db.delete(organizations);
  await t.db.delete(instanceSettings);
}

async function setSetting(key: string, value: unknown) {
  await t.db.insert(instanceSettings).values({ key, value }).onConflictDoUpdate({ target: instanceSettings.key, set: { value } });
}

async function create(email: string, opts: Parameters<typeof createAccountUnderPolicy>[2] = {}, extra: Record<string, unknown> = {}) {
  return createAccountUnderPolicy(t.db, { email, name: email.split("@")[0]!, ...extra }, opts);
}

async function caught(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

beforeEach(async () => {
  delete env.SIGNUP_POLICY;
  delete env.ADMIN_EMAILS;
  await wipe();
});
afterEach(() => {
  delete env.SIGNUP_POLICY;
  delete env.ADMIN_EMAILS;
});

describe("signupPolicyAllows", () => {
  it("always allows the first account of a fresh instance, whatever the policy", async () => {
    await setSetting("signup_policy", "invite_only");
    const d = await signupPolicyAllows("first@example.com", { db: t.db });
    expect(d).toMatchObject({ allowed: true, firstUser: true, policy: "invite_only" });
  });

  it("defaults to invite_only once an account exists", async () => {
    await create("owner@example.com");
    expect(await getSignupPolicy(t.db)).toBe("invite_only");
    expect(await signupPolicyAllows("new@example.com", { db: t.db })).toEqual({
      allowed: false,
      firstUser: false,
      policy: "invite_only",
      message: SIGNUPS_CLOSED_MESSAGE,
    });
  });

  it("open lets anyone sign up into their own organization", async () => {
    await create("owner@example.com");
    await setSetting("signup_policy", "open");
    expect(await signupPolicyAllows("new@example.com", { db: t.db })).toMatchObject({ allowed: true, firstUser: false, joinOrganizationId: null });
  });

  it("domains allows listed domains (joining the first organization) and closes for others", async () => {
    const { user: owner } = await create("owner@acme.test");
    await setSetting("signup_policy", "domains");
    await setSetting("signup_domains", ["acme.test", "@Partner.Example"]);
    const [m] = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, owner.id));
    expect(await signupPolicyAllows("ann@ACME.test", { db: t.db })).toMatchObject({ allowed: true, joinOrganizationId: m!.organizationId });
    expect(await signupPolicyAllows("bo@partner.example", { db: t.db })).toMatchObject({ allowed: true });
    expect(await signupPolicyAllows("eve@evil.test", { db: t.db })).toMatchObject({ allowed: false, message: SIGNUPS_CLOSED_MESSAGE });
  });

  it("SIGNUP_POLICY overrides the instance setting", async () => {
    await create("owner@example.com");
    await setSetting("signup_policy", "invite_only");
    env.SIGNUP_POLICY = "open";
    expect(await getSignupPolicy(t.db)).toBe("open");
    expect((await signupPolicyAllows("x@example.com", { db: t.db })).allowed).toBe(true);
    env.SIGNUP_POLICY = "invite_only";
    await setSetting("signup_policy", "open");
    expect((await signupPolicyAllows("x@example.com", { db: t.db })).allowed).toBe(false);
  });

  it("ADMIN_EMAILS can always sign up", async () => {
    await create("owner@example.com");
    env.ADMIN_EMAILS = "Ops@Example.com, other@example.com";
    expect((await signupPolicyAllows("ops@example.com", { db: t.db })).allowed).toBe(true);
    expect((await signupPolicyAllows("random@example.com", { db: t.db })).allowed).toBe(false);
  });
});

describe("getSignupAvailability (what /signup and /login show)", () => {
  it("is open for the first account, closed under invite_only, open under open and domains", async () => {
    expect(await getSignupAvailability(t.db)).toMatchObject({ open: true, firstUser: true });
    await create("owner@example.com");
    expect(await getSignupAvailability(t.db)).toMatchObject({ open: false, firstUser: false, policy: "invite_only" });
    await setSetting("signup_policy", "domains");
    expect((await getSignupAvailability(t.db)).open).toBe(true);
    await setSetting("signup_policy", "open");
    expect((await getSignupAvailability(t.db)).open).toBe(true);
    await setSetting("signup_policy", "invite_only");
    env.ADMIN_EMAILS = "ops@example.com";
    expect((await getSignupAvailability(t.db)).open).toBe(true);
  });
});

describe("createAccountUnderPolicy", () => {
  it("makes the first account instance admin and owner of a new workspace; the next ones are not admins", async () => {
    const first = await create("first@example.com");
    expect(first.user.isInstanceAdmin).toBe(true);
    expect(first.decision).toMatchObject({ allowed: true, firstUser: true });
    const [m] = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, first.user.id));
    expect(m?.role).toBe("owner");

    await setSetting("signup_policy", "open");
    const second = await create("second@example.com");
    expect(second.user.isInstanceAdmin).toBe(false);
    const [m2] = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, second.user.id));
    expect(m2?.role).toBe("owner");
    expect(m2?.organizationId).not.toBe(m?.organizationId);
  });

  it("rejects closed signups with the AU-11 message and taken emails with the AU-01 message", async () => {
    await create("owner@example.com");
    const closed = await caught(create("new@example.com"));
    expect(isAppError(closed) && closed.code).toBe("forbidden");
    expect((closed as Error).message).toBe(SIGNUPS_CLOSED_MESSAGE);

    await setSetting("signup_policy", "open");
    const taken = await caught(create(" OWNER@example.com "));
    expect(isAppError(taken) && taken.code).toBe("conflict");
    expect((taken as Error).message).toBe(EMAIL_TAKEN_MESSAGE);
    expect(isAppError(taken) && taken.fieldErrors?.email).toEqual([EMAIL_TAKEN_MESSAGE]);
  });

  it("joins the first organization as User under a matching domains policy", async () => {
    const { user: owner } = await create("owner@acme.test");
    const [om] = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, owner.id));
    await setSetting("signup_policy", "domains");
    await setSetting("signup_domains", ["acme.test"]);
    const { user } = await create("dev@acme.test");
    const [m] = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, user.id));
    expect(m).toMatchObject({ organizationId: om!.organizationId, role: "user" });
  });

  it("bypasses the policy for invitations, inside the inviting organization with the invited role", async () => {
    const { user: owner } = await create("owner@example.com");
    const [om] = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, owner.id));
    const { user } = await create("invited@example.com", { bypassPolicy: true }, { organizationId: om!.organizationId, role: "admin" });
    const [m] = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, user.id));
    expect(m).toMatchObject({ organizationId: om!.organizationId, role: "admin" });
    expect(user.isInstanceAdmin).toBe(false);
  });
});
