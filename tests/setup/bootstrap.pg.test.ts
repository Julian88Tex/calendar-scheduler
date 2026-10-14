// Owner bootstrap races on real Postgres (PGlite is a single backend and cannot prove them, ARCHITECTURE 24.1):
// - simultaneous bootstraps create one account and apply the snapshot once (no duplicate event types or reminders);
// - a bootstrap racing a stranger's first signup (invite_only) never leaves two accounts: either the stranger got in
//   first and the bootstrap refused with 409, or the owner got in first and the signup was refused.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { availabilitySchedules, eventTypes, handles, instanceSettings, organizations, users, workflows } from "@/db/schema";
import { createAccountUnderPolicy } from "@/lib/auth/signup";
import { isAppError } from "@/lib/errors";
import { bootstrapOwner } from "@/lib/setup/bootstrap";
import { createTestDb, type TestDb } from "../helpers/db";

const env = process.env as Record<string, string | undefined>;
const OWNER = "julian@example.com";

describe.runIf(process.env.TEST_DATABASE_URL)("owner bootstrap races on real Postgres", () => {
  let t: TestDb;
  let pools: DB[];

  beforeAll(async () => {
    t = await createTestDb({ kind: "postgres" });
    pools = await Promise.all(Array.from({ length: 4 }, () => t.connect(2)));
  });
  afterAll(async () => {
    delete env.SIGNUP_POLICY;
    await t?.close();
  });
  beforeEach(async () => {
    env.SIGNUP_POLICY = "invite_only";
    await t.db.delete(users);
    await t.db.delete(organizations);
    await t.db.delete(handles);
    await t.db.delete(instanceSettings);
  });

  it("simultaneous bootstraps create one account and apply the snapshot once", async () => {
    const results = await Promise.allSettled(pools.map((db) => bootstrapOwner({ email: OWNER }, { db })));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const values = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof bootstrapOwner>>>).value);
    expect(values.filter((v) => v.account === "created")).toHaveLength(1);
    expect(values.filter((v) => v.snapshot.status === "applied")).toHaveLength(1);
    const rows = await t.db.select().from(users);
    expect(rows).toHaveLength(1);
    const owner = rows[0]!;
    expect(await t.db.select().from(eventTypes).where(eq(eventTypes.ownerUserId, owner.id))).toHaveLength(3);
    expect(await t.db.select().from(availabilitySchedules).where(eq(availabilitySchedules.userId, owner.id))).toHaveLength(2);
    expect(await t.db.select().from(workflows).where(eq(workflows.ownerUserId, owner.id))).toHaveLength(3);
  });

  it("a bootstrap racing a stranger's first signup never leaves two accounts", async () => {
    for (let round = 0; round < 4; round++) {
      await t.db.delete(users);
      await t.db.delete(organizations);
      await t.db.delete(handles);
      const [boot, signup] = await Promise.allSettled([
        bootstrapOwner({ email: OWNER }, { db: pools[round % 2]! }),
        createAccountUnderPolicy(pools[2 + (round % 2)]!, { email: `stranger${round}@example.com`, name: "Stranger" }),
      ]);
      const rows = await t.db.select({ email: users.emailNormalized, isInstanceAdmin: users.isInstanceAdmin }).from(users);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.isInstanceAdmin).toBe(true);
      if (rows[0]!.email === OWNER) {
        expect(boot.status).toBe("fulfilled");
        expect(signup.status === "rejected" && isAppError(signup.reason) && signup.reason.code).toBe("forbidden");
      } else {
        expect(signup.status).toBe("fulfilled");
        expect(boot.status === "rejected" && isAppError(boot.reason) && boot.reason.code).toBe("conflict");
      }
    }
  });
});
