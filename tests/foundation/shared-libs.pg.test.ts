// Shared libraries under real concurrency (ARCHITECTURE 24.1: PGlite serializes everything, so these need Postgres).
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { handles } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { getOrCreateAppSecret } from "@/lib/secrets";
import { claimHandle } from "@/lib/slugs";
import { createTestDb } from "../helpers/db";
import { createUser } from "../factories";

describe.runIf(process.env.TEST_DATABASE_URL)("shared libs on real Postgres", () => {
  it("rate limit counts are atomic across connections", async () => {
    const t = await createTestDb({ kind: "postgres", setGlobal: false });
    try {
      const pools = await Promise.all(Array.from({ length: 12 }, () => t.connect(1)));
      const at = Date.parse("2030-01-01T00:00:30Z");
      const results = await Promise.all(pools.map((db) => rateLimit("pg:concurrent", 5, 60, { db, nowMs: at })));
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    } finally {
      await t.close();
    }
  });

  it("concurrent cold starts agree on one generated app secret", async () => {
    const t = await createTestDb({ kind: "postgres", setGlobal: false });
    try {
      const pools = await Promise.all(Array.from({ length: 8 }, () => t.connect(1)));
      const values = await Promise.all(
        pools.map((db) => getOrCreateAppSecret("pg_race_secret", () => randomBytes(32).toString("base64url"), db)),
      );
      expect(new Set(values).size).toBe(1);
    } finally {
      await t.close();
    }
  });

  it("two users claiming the same handle at once: exactly one wins", async () => {
    const t = await createTestDb({ kind: "postgres", setGlobal: false });
    try {
      const a = await createUser(t.db, { withoutHandle: true, slug: "race-a" });
      const b = await createUser(t.db, { withoutHandle: true, slug: "race-b" });
      const [pa, pb] = await Promise.all([t.connect(1), t.connect(1)]);
      const outcomes = await Promise.allSettled([
        pa.transaction((tx) => claimHandle(tx, "contested-handle", { userId: a.id }, { updateMirror: false })),
        pb.transaction((tx) => claimHandle(tx, "contested-handle", { userId: b.id }, { updateMirror: false })),
      ]);
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: "conflict", message: "This URL is not available." });
      expect(await t.db.select().from(handles).where(eq(handles.slug, "contested-handle"))).toHaveLength(1);
    } finally {
      await t.close();
    }
  });
});
