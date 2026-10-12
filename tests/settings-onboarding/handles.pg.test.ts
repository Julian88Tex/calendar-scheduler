// My Link races on real Postgres (SPEC BR-08, GEN-02; run with npm run test:pg): several accounts changing to the
// same free URL at once end with exactly one owner and clean "not available" errors for the others (never an internal
// error), and one account saving two different URLs at once ends with exactly one handle that matches users.slug.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const { handles, users } = await import("@/db/schema");
const { loadActorCtx } = await import("@/lib/authz");
const { isAppError } = await import("@/lib/errors");
const { changeHandle } = await import("@/lib/settings");
const f = await import("../factories");
const { createTestDb } = await import("../helpers/db");

describe.runIf(process.env.TEST_DATABASE_URL)("slug change races on real Postgres", () => {
  it("concurrent changes to the same URL leave exactly one owner", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    try {
      const people = await Promise.all(Array.from({ length: 6 }, () => f.createUser(t.db)));
      const actors = await Promise.all(
        people.map(async (p) => loadActorCtx(t.db, (await t.db.select().from(users).where(eq(users.id, p.id)))[0]!)),
      );
      const results = await Promise.allSettled(actors.map((a) => changeHandle(t.db, a, "the-one-url")));
      const won = results.filter((r) => r.status === "fulfilled");
      expect(won).toHaveLength(1);
      for (const r of results) {
        if (r.status === "rejected") {
          expect(isAppError(r.reason)).toBe(true);
          expect(r.reason.code).toBe("conflict");
          expect(["This URL is taken", "This URL is not available."]).toContain(r.reason.fieldErrors?.slug?.[0]);
        }
      }
      const owners = await t.db.select().from(handles).where(eq(handles.slug, "the-one-url"));
      expect(owners).toHaveLength(1);
      const winner = await t.db.select({ slug: users.slug }).from(users).where(eq(users.id, owners[0]!.userId!));
      expect(winner[0]?.slug).toBe("the-one-url");
      // The losers kept their own URL.
      for (const p of people.filter((x) => x.id !== owners[0]!.userId)) {
        const [h] = await t.db.select().from(handles).where(eq(handles.userId, p.id));
        expect(h?.slug).toBe(p.slug);
      }
    } finally {
      await t.close();
    }
  });

  it("one account saving two URLs at once keeps a single consistent handle", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    try {
      const p = await f.createUser(t.db);
      const actor = await loadActorCtx(t.db, (await t.db.select().from(users).where(eq(users.id, p.id)))[0]!);
      await Promise.allSettled([changeHandle(t.db, actor, "first-choice"), changeHandle(t.db, actor, "second-choice")]);
      const mine = await t.db.select().from(handles).where(eq(handles.userId, p.id));
      expect(mine).toHaveLength(1);
      const [row] = await t.db.select({ slug: users.slug }).from(users).where(eq(users.id, p.id));
      expect(row?.slug).toBe(mine[0]!.slug);
      expect(["first-choice", "second-choice"]).toContain(mine[0]!.slug);
    } finally {
      await t.close();
    }
  });
});
