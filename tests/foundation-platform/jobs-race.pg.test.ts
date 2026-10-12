// Race safety on real Postgres (ARCHITECTURE sections 12.2 and 24.1; run with npm run test:pg): concurrent runDueJobs
// workers (separate pool connections) never run one job twice; leases have a single holder; concurrent email retries
// deliver once.
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ runs: [] as string[] }));

vi.mock("@/lib/booking/jobs", () => ({
  handlers: {
    "booking.race": async (payload: { n: number }) => {
      h.runs.push(String(payload.n));
      await new Promise((r) => setTimeout(r, 2 + (payload.n % 5)));
    },
  },
  periodic: [],
}));
for (const m of ["admin", "calendars", "contacts", "lifecycle", "links", "meetings", "payments", "polls", "settings", "teams", "webhooks", "workflows"]) {
  vi.doMock(`@/lib/${m}/jobs`, () => ({ handlers: {}, periodic: [] }));
}

const { emailOutbox, jobs } = await import("@/db/schema");
const { enqueueJobs, runDueJobs } = await import("@/lib/jobs");
const { acquireLease } = await import("@/lib/jobs/lease");
const { retryEmailDelivery } = await import("@/lib/email");
const { createTestDb } = await import("../helpers/db");
const { mockFetch } = await import("../helpers/fake-providers");

describe.runIf(process.env.TEST_DATABASE_URL)("jobs runner on real Postgres", () => {
  it("concurrent workers never run one job twice", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 12 });
    try {
      h.runs.length = 0;
      const N = 120;
      await enqueueJobs(
        t.db,
        Array.from({ length: N }, (_, n) => ({ type: "booking.race", payload: { n }, priority: n % 3 })),
      );
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, w) => runDueJobs({ budgetMs: 60_000, types: ["booking.race"], workerId: `w${w}`, maxJobs: 1_000 })),
      );
      expect(results.reduce((s, r) => s + r.ran, 0)).toBe(N);
      expect(results.reduce((s, r) => s + r.succeeded, 0)).toBe(N);
      // More than one worker did real work (the claims interleaved).
      expect(results.filter((r) => r.ran > 0).length).toBeGreaterThan(1);
      expect(h.runs).toHaveLength(N);
      expect(new Set(h.runs).size).toBe(N);
      const rows = await t.db.select({ status: jobs.status, attempts: jobs.attempts }).from(jobs);
      expect(rows.every((r) => r.status === "succeeded" && r.attempts === 1)).toBe(true);
    } finally {
      await t.close();
    }
  });

  it("a lease has exactly one holder under contention", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 12 });
    try {
      const pools = await Promise.all(Array.from({ length: 10 }, () => t.connect(1)));
      const at = new Date();
      const got = await Promise.all(pools.map((p, i) => acquireLease(p, "race_lease", 60_000, `holder-${i}`, at)));
      expect(got.filter(Boolean)).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("concurrent retries of one failed email deliver it once", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 12 });
    const env = process.env as Record<string, string | undefined>;
    env.RESEND_API_KEY = "re_race";
    const f = mockFetch({
      method: "POST",
      url: "https://api.resend.com/emails",
      handler: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { id: "re_once" };
      },
    });
    try {
      const [row] = await t.db
        .insert(emailOutbox)
        .values({
          toAddresses: ["a@example.com"],
          fromAddress: "notifications@localhost",
          subject: "Hi",
          html: "<p>Hi</p>",
          text: "Hi",
          template: "t",
          category: "system",
          status: "failed",
          provider: "resend",
          attempts: 1,
          idempotencyKey: "race-email",
        })
        .returning();
      const outcomes = await Promise.all(Array.from({ length: 6 }, () => retryEmailDelivery(row!.id)));
      expect(outcomes.filter((o) => o === "sent")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "skipped")).toHaveLength(5);
      expect(f.calls).toHaveLength(1);
      expect((await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, row!.id)))[0]).toMatchObject({ status: "sent", attempts: 2 });
    } finally {
      f.restore();
      delete env.RESEND_API_KEY;
      await t.close();
    }
  });
});
