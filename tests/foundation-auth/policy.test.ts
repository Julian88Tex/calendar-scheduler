// Signup policy matrix (SPEC AU-11): first user, invite_only, open, domains, SIGNUP_POLICY override, ADMIN_EMAILS, and
// createAccountUnderPolicy (first account is instance admin, domains joins the first organization, invitations bypass).
// With OWNER_EMAIL set, the first-account exception applies to that address only, and only when the signup proves it
// (a verified provider email, never a password signup): the owner bootstrap's rule.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { instanceSettings, organizationMemberships, organizations, users } from "@/db/schema";
import {
  firstAccountExceptionAllows,
  getSignupAvailability,
  getSignupPolicy,
  OWNER_SIGNUP_NEEDS_PROOF_MESSAGE,
  signupPolicyAllows,
  SIGNUPS_CLOSED_MESSAGE,
} from "@/lib/auth/policy";
import { checkSignupEmail, signUpWithPassword } from "@/lib/auth/flows/signup-flow";
import { createAccountUnderPolicy, EMAIL_TAKEN_MESSAGE } from "@/lib/auth/signup";
import { isInstanceAdminUser } from "@/lib/authz";
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
  delete env.OWNER_EMAIL;
  await wipe();
});
afterEach(() => {
  delete env.SIGNUP_POLICY;
  delete env.ADMIN_EMAILS;
  delete env.OWNER_EMAIL;
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

describe("OWNER_EMAIL and the first-account exception", () => {
  const verified = { emailVerifiedAt: new Date() };

  it("lets only OWNER_EMAIL (case-insensitive, trimmed), with a proven address, claim a fresh instance; anyone else follows the policy", async () => {
    env.OWNER_EMAIL = "  Owner@Example.com ";
    await setSetting("signup_policy", "invite_only");
    expect(await signupPolicyAllows("eve@example.com", { db: t.db, emailVerified: true })).toEqual({
      allowed: false,
      firstUser: false,
      policy: "invite_only",
      message: SIGNUPS_CLOSED_MESSAGE,
    });
    expect(await signupPolicyAllows(" OWNER@example.COM ", { db: t.db, emailVerified: true })).toMatchObject({
      allowed: true,
      firstUser: true,
      policy: "invite_only",
    });
    expect(firstAccountExceptionAllows("owner@EXAMPLE.com", { emailVerified: true })).toBe(true);
    expect(firstAccountExceptionAllows("owner2@example.com", { emailVerified: true })).toBe(false);
    expect(firstAccountExceptionAllows("owner@example.com")).toBe(false);
  });

  it("createAccountUnderPolicy refuses another first signup and makes the owner's verified signup instance admin", async () => {
    env.OWNER_EMAIL = "owner@example.com";
    const closed = await caught(create("eve@example.com", {}, verified));
    expect(isAppError(closed) && closed.code).toBe("forbidden");
    expect((closed as Error).message).toBe(SIGNUPS_CLOSED_MESSAGE);
    expect(await t.db.select().from(users)).toHaveLength(0);
    const owner = await create("Owner@Example.com", {}, verified);
    expect(owner.user.isInstanceAdmin).toBe(true);
    expect(owner.decision).toMatchObject({ allowed: true, firstUser: true });
  });

  it("never lets a password signup with the owner's address (not proven) be the first account, whatever the policy", async () => {
    env.OWNER_EMAIL = "owner@example.com";
    // A password signup needs no proof of the address: anyone can type the owner's email (pre-account hijacking). The
    // bootstrap refuses such an account as possibly a squatter's (who could link their own sign-in method or calendar
    // to it before the owner claims it), so the policy never creates it.
    expect(await signupPolicyAllows("Owner@Example.com", { db: t.db })).toEqual({
      allowed: false,
      firstUser: false,
      policy: "invite_only",
      message: OWNER_SIGNUP_NEEDS_PROOF_MESSAGE,
    });
    const squatted = await caught(create("Owner@Example.com"));
    expect(isAppError(squatted) && squatted.code).toBe("forbidden");
    expect((squatted as Error).message).toBe(OWNER_SIGNUP_NEEDS_PROOF_MESSAGE);

    // Not even through a rule that lets anyone else in: ADMIN_EMAILS listing the owner (docs/DEPLOY.md), open, domains.
    env.ADMIN_EMAILS = "owner@example.com";
    expect(await signupPolicyAllows("owner@example.com", { db: t.db })).toMatchObject({ allowed: false, message: OWNER_SIGNUP_NEEDS_PROOF_MESSAGE });
    for (const policy of ["open", "domains"] as const) {
      env.SIGNUP_POLICY = policy;
      await setSetting("signup_domains", ["example.com"]);
      expect(await signupPolicyAllows("owner@example.com", { db: t.db })).toMatchObject({ allowed: false, policy, message: OWNER_SIGNUP_NEEDS_PROOF_MESSAGE });
      expect((await caught(create("owner@example.com"))) as Error).toMatchObject({ code: "forbidden", message: OWNER_SIGNUP_NEEDS_PROOF_MESSAGE });
      // Someone else still follows the policy (both let them in, as an ordinary account).
      expect(await signupPolicyAllows("eve@example.com", { db: t.db })).toMatchObject({ allowed: true, firstUser: false });
    }
    delete env.SIGNUP_POLICY;

    // The real email and password signup (both steps) refuses it the same way.
    const meta = { ip: "198.51.100.77", userAgent: null };
    const step1 = await caught(checkSignupEmail({ email: " OWNER@example.com ", meta, db: t.db }));
    expect(isAppError(step1) && step1.fieldErrors?.email).toEqual([OWNER_SIGNUP_NEEDS_PROOF_MESSAGE]);
    const step2 = await caught(signUpWithPassword({ email: "owner@example.com", name: "Not the owner", password: "squatter1", meta, db: t.db }));
    expect(isAppError(step2) && step2.code).toBe("forbidden");
    expect(await t.db.select().from(users)).toHaveLength(0);

    // The owner proving the address (Google or Microsoft) claims the instance even with ADMIN_EMAILS listing it.
    const owner = await create("owner@example.com", {}, verified);
    expect(owner.user.isInstanceAdmin).toBe(true);
    expect(isInstanceAdminUser(owner.user)).toBe(true);
  });

  it("refuses the owner's unproven signup only on a fresh instance (later the address is taken or follows the policy)", async () => {
    env.OWNER_EMAIL = "owner@example.com";
    env.SIGNUP_POLICY = "open";
    await create("eve@example.com");
    // Under open a non-owner was first (ordinary account); the owner's address then follows the policy like any other.
    const later = await create("owner@example.com");
    expect(later.decision).toMatchObject({ allowed: true, firstUser: false });
    expect(later.user.isInstanceAdmin).toBe(false);
  });

  it("a first signup allowed by the policy itself (open, domains, ADMIN_EMAILS) is not made instance admin", async () => {
    env.OWNER_EMAIL = "owner@example.com";
    env.SIGNUP_POLICY = "open";
    expect(await signupPolicyAllows("eve@example.com", { db: t.db, emailVerified: true })).toMatchObject({ allowed: true, firstUser: false, policy: "open" });
    const eve = await create("eve@example.com", {}, verified);
    expect(eve.user.isInstanceAdmin).toBe(false);
    expect(eve.decision).toMatchObject({ allowed: true, firstUser: false });

    await wipe();
    env.SIGNUP_POLICY = "domains";
    await setSetting("signup_domains", ["acme.test"]);
    expect(await signupPolicyAllows("dev@acme.test", { db: t.db })).toMatchObject({ allowed: true, firstUser: false, joinOrganizationId: null });
    expect((await signupPolicyAllows("eve@evil.test", { db: t.db })).allowed).toBe(false);

    delete env.SIGNUP_POLICY;
    env.ADMIN_EMAILS = "ops@example.com";
    expect(await signupPolicyAllows("ops@example.com", { db: t.db })).toMatchObject({ allowed: true, firstUser: false });
    expect((await create("ops@example.com", {}, verified)).user.isInstanceAdmin).toBe(false);
  });

  it("gives the exception to nobody while OWNER_EMAIL is malformed (like the bootstrap, which it disables)", async () => {
    env.OWNER_EMAIL = "not-an-email";
    expect(firstAccountExceptionAllows("not-an-email", { emailVerified: true })).toBe(false);
    expect(firstAccountExceptionAllows("owner@example.com", { emailVerified: true })).toBe(false);
    expect(await signupPolicyAllows("owner@example.com", { db: t.db, emailVerified: true })).toMatchObject({ allowed: false, message: SIGNUPS_CLOSED_MESSAGE });
    const closed = await caught(create("owner@example.com", {}, verified));
    expect(isAppError(closed) && closed.code).toBe("forbidden");
  });

  it("keeps the exception for anyone, password signups included, while OWNER_EMAIL is unset or empty", async () => {
    env.OWNER_EMAIL = "   ";
    expect(firstAccountExceptionAllows("anyone@example.com")).toBe(true);
    expect(await signupPolicyAllows("anyone@example.com", { db: t.db })).toMatchObject({ allowed: true, firstUser: true });
    delete env.OWNER_EMAIL;
    expect((await create("anyone@example.com")).user.isInstanceAdmin).toBe(true);
  });

  it("shows the signup form on a fresh instance (the owner must be able to sign up)", async () => {
    env.OWNER_EMAIL = "owner@example.com";
    expect(await getSignupAvailability(t.db)).toMatchObject({ open: true, firstUser: true });
  });

  it("whichever of two first signups runs first under the signup lock, only the owner's becomes instance admin", async () => {
    // The real concurrency (separate connections) is covered by signup-race.pg.test.ts; PGlite runs them in turn.
    env.OWNER_EMAIL = "owner@example.com";
    for (const order of [["eve@example.com", "owner@example.com"], ["owner@example.com", "eve@example.com"]]) {
      await wipe();
      const results = await Promise.allSettled(order.map((email) => create(email, {}, verified)));
      const admins = (await t.db.select().from(users)).map((u) => [u.emailNormalized, u.isInstanceAdmin]);
      expect(admins).toEqual([["owner@example.com", true]]);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    }
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
