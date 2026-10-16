// First-account race (SPEC AU-11, foundation verifier follow-up): the signup policy reads the user count, so it is
// evaluated inside the account transaction under the signup advisory lock. On real Postgres, simultaneous first
// signups on separate connections must produce exactly one instance admin; under invite_only exactly one of them
// may succeed at all. PGlite is a single backend and cannot prove this (ARCHITECTURE section 24.1).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { instanceSettings, organizations, users } from "@/db/schema";
import { createAccountUnderPolicy } from "@/lib/auth/signup";
import { isAppError } from "@/lib/errors";
import { createTestDb, type TestDb } from "../helpers/db";

const env = process.env as Record<string, string | undefined>;

describe.runIf(process.env.TEST_DATABASE_URL)("first signup race on real Postgres", () => {
  let t: TestDb;
  let pools: DB[];

  beforeAll(async () => {
    t = await createTestDb({ kind: "postgres" });
    pools = await Promise.all(Array.from({ length: 6 }, () => t.connect(1)));
  });
  afterAll(async () => {
    delete env.SIGNUP_POLICY;
    await t?.close();
  });
  beforeEach(async () => {
    delete env.SIGNUP_POLICY;
    await t.db.delete(users);
    await t.db.delete(organizations);
    await t.db.delete(instanceSettings);
  });

  const signups = (prefix: string) =>
    Promise.allSettled(
      pools.map((db, i) => createAccountUnderPolicy(db, { email: `${prefix}${i}@example.com`, name: `User ${i}` })),
    );

  it("simultaneous first signups under the open policy create exactly one instance admin", async () => {
    env.SIGNUP_POLICY = "open";
    const results = await signups("open");
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const rows = await t.db.select({ id: users.id, isInstanceAdmin: users.isInstanceAdmin }).from(users);
    expect(rows).toHaveLength(pools.length);
    expect(rows.filter((r) => r.isInstanceAdmin)).toHaveLength(1);
    const firstUserDecisions = results.filter((r) => r.status === "fulfilled" && r.value.decision.allowed && r.value.decision.firstUser);
    expect(firstUserDecisions).toHaveLength(1);
  });

  it("simultaneous first signups under invite_only let exactly one in", async () => {
    env.SIGNUP_POLICY = "invite_only";
    const results = await signups("closed");
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(pools.length - 1);
    for (const r of rejected) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(isAppError(reason) && reason.code).toBe("forbidden");
    }
    const [{ n } = { n: 0 }] = (await t.db.execute(sql`select count(*)::int as n from users where is_instance_admin`)) as unknown as { n: number }[];
    expect(Number(n)).toBe(1);
  });

  it("the same email signing up twice at once creates one account", async () => {
    env.SIGNUP_POLICY = "open";
    const results = await Promise.allSettled(
      pools.slice(0, 3).map((db) => createAccountUnderPolicy(db, { email: "Twin@Example.com", name: "Twin" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await t.db.select({ id: users.id }).from(users);
    expect(rows).toHaveLength(1);
  });
});
