// AU-14 under real concurrency: parallel wrong passwords for one email on separate Postgres connections. Each attempt is
// counted atomically (INSERT ... ON CONFLICT DO UPDATE) before the scrypt check, so at most 10 passwords are checked
// per email per 15 minutes however many requests arrive at once. A read-only peek before counting let every request
// of a burst through (adversarial review). PGlite is a single backend, so this runs on Postgres (ARCHITECTURE 24.1).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { organizations, rateLimitBuckets, users } from "@/db/schema";
import { authenticateWithPassword } from "@/lib/auth/login";
import { hashPassword } from "@/lib/crypto";
import { createUser } from "../factories";
import { createTestDb, type TestDb } from "../helpers/db";

describe.runIf(process.env.TEST_DATABASE_URL)("login burst on real Postgres", () => {
  let t: TestDb;
  let pools: DB[];

  beforeAll(async () => {
    t = await createTestDb({ kind: "postgres" });
    pools = await Promise.all(Array.from({ length: 6 }, () => t.connect(1)));
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await t.db.delete(rateLimitBuckets);
    await t.db.delete(users);
    await t.db.delete(organizations);
  });

  it("checks at most 10 of 24 simultaneous wrong passwords for one email", async () => {
    const u = await createUser(t.db, { passwordHash: await hashPassword("correct-horse1") });
    const results = await Promise.allSettled(
      Array.from({ length: 24 }, (_, i) =>
        authenticateWithPassword({
          email: u.email,
          password: `wrong-${i}a`,
          meta: { ip: `192.0.2.${i + 1}`, userAgent: null },
          db: pools[i % pools.length]!,
        }),
      ),
    );
    const codes = results.map((r) => (r.status === "rejected" ? (r.reason as { code?: string }).code : "ok"));
    expect(codes.filter((c) => c === "ok")).toHaveLength(0);
    expect(codes.filter((c) => c === "unauthorized").length).toBeLessThanOrEqual(10);
    expect(codes.filter((c) => c === "rate_limited").length).toBeGreaterThanOrEqual(14);
  });
});
