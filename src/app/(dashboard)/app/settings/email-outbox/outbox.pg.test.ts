// The email outbox page read model and "Resend" on real Postgres through postgres.js, the production driver
// (npm run test:pg; golden-path-qa). PGlite serializes parameters itself and its clock has millisecond resolution, so
// the default suite (outbox.test.ts) cannot see what this file checks:
// - the raw sql`` parts (the recipient search over array_to_string(...) ilike, the "Waiting for Gmail" prefix match)
//   and the counts (int8, a string from postgres.js) work with production parameter serialization;
// - "Resend" compares the version the page showed (milliseconds) with an updated_at the database filled itself
//   (microseconds): the compare-and-set must still match it once, and refuse the same version again;
// - a page number from a tampered URL never reaches Postgres as an OFFSET beyond bigint.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { emailOutbox } = await import("@/db/schema");
const { loadActorCtx } = await import("@/lib/authz");
const { GMAIL_HOLD_PREFIX } = await import("@/lib/email");
const { createTestDb } = await import("../../../../../../tests/helpers/db");
const { createUser } = await import("../../../../../../tests/factories");
const { loadOutboxEmail, loadOutboxPage, resendFailedEmail, OUTBOX_MAX_PAGE } = await import("./data");

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
type TestUser = Awaited<ReturnType<typeof createUser>>;

describe.runIf(process.env.TEST_DATABASE_URL)("email outbox on real Postgres (postgres.js)", () => {
  let t: TestDb;
  let admin: TestUser;
  let otherOwner: TestUser;
  let seq = 0;
  const env = process.env as Record<string, string | undefined>;

  /** An outbox row whose created_at and updated_at the database fills (microsecond precision). */
  async function row(over: Partial<typeof emailOutbox.$inferInsert> = {}) {
    seq++;
    const [r] = await t.db
      .insert(emailOutbox)
      .values({
        toAddresses: [`invitee${seq}@example.com`],
        ccAddresses: seq % 2 ? [`cc${seq}@example.com`] : [],
        fromAddress: "notifications@localhost",
        subject: `Subject ${seq}`,
        html: `<p>Body ${seq}</p>`,
        text: `Body ${seq}`,
        template: "lifecycle.invitee_confirmation",
        category: "transactional",
        status: "sent",
        provider: "resend",
        attempts: 1,
        idempotencyKey: `pg-outbox:${seq}`,
        organizationId: admin.organizationId,
        ...over,
      })
      .returning();
    return r!;
  }

  beforeAll(async () => {
    t = await createTestDb({ kind: "postgres" });
    admin = await createUser(t.db, { name: "Owner One", email: "owner1@example.com", isInstanceAdmin: true });
    otherOwner = await createUser(t.db, { name: "Other Owner", email: "other@example.com" });
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    for (const k of ["RESEND_API_KEY", "SMTP_HOST", "EMAIL_PROVIDER"]) delete env[k];
    await t.db.delete(emailOutbox);
  });

  it("lists, counts, filters and searches with production parameters", async () => {
    await row({ subject: "Confirmed: 30 Minute Virtual", toAddresses: ["Sam.Lee@example.com"] });
    await row({ status: "failed", provider: "gmail", attempts: 0, lastError: `${GMAIL_HOLD_PREFIX}Reconnect it.` });
    await row({ status: "failed", attempts: 8, lastError: "permanent: 550 mailbox unavailable" });
    await row({ status: "sending" });
    await row({ subject: "Theirs", organizationId: otherOwner.organizationId });
    const actor = await loadActorCtx(t.db, admin);
    const all = await loadOutboxPage(actor, { status: "all", q: "", page: 1 });
    expect(all.total).toBe(5);
    expect(typeof all.total).toBe("number");
    expect(all.waitingForGmail).toBe(1);
    expect(typeof all.waitingForGmail).toBe("number");
    const times = all.rows.map((r) => Date.parse(r.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const by = async (status: Parameters<typeof loadOutboxPage>[1]["status"], q = "") => (await loadOutboxPage(actor, { status, q, page: 1 })).rows;
    expect((await by("waiting_gmail")).map((r) => r.status.reason)).toEqual(["Reconnect it."]);
    expect((await by("failed")).map((r) => r.status.reason)).toEqual(["550 mailbox unavailable"]);
    expect(await by("queued")).toHaveLength(1);
    expect((await by("all", "sam.lee@EXAMPLE")).map((r) => r.subject)).toEqual(["Confirmed: 30 Minute Virtual"]);
    expect(await by("all", "cc1@example")).toHaveLength(1); // cc addresses are searched too
    expect(await by("all", "50%_x")).toHaveLength(0);

    // An organization owner who is not an instance admin: their organization only.
    const mine = await loadOutboxPage(await loadActorCtx(t.db, otherOwner), { status: "all", q: "", page: 1 });
    expect(mine.rows.map((r) => r.subject)).toEqual(["Theirs"]);
    expect(await loadOutboxEmail(await loadActorCtx(t.db, otherOwner), all.rows.find((r) => r.subject !== "Theirs")!.id)).toBeNull();

    // A tampered page number: an empty last page, never an OFFSET beyond bigint.
    const far = await loadOutboxPage(actor, { status: "all", q: "", page: 1e18 });
    expect(far).toMatchObject({ rows: [], total: 5, page: OUTBOX_MAX_PAGE });
  });

  it("resends once against a database-filled updated_at (microseconds) and refuses the same version again", async () => {
    const original = await row({ status: "failed", attempts: 8, lastError: "permanent: 550 mailbox unavailable", subject: "Reminder" });
    const [{ micros }] = (await t.db.execute(sql`select extract(microseconds from ${emailOutbox.updatedAt})::int % 1000 as micros from ${emailOutbox} where ${emailOutbox.id} = ${original.id}`)) as unknown as [{ micros: number }];
    expect(typeof micros).toBe("number"); // the database value carries sub-millisecond digits the page never sees
    const actor = await loadActorCtx(t.db, admin);
    const view = await loadOutboxEmail(actor, original.id);
    expect(view?.status).toMatchObject({ kind: "failed", canResend: true, reason: "550 mailbox unavailable" });

    const res = await resendFailedEmail(actor, { id: original.id, version: view!.version });
    expect(res.status).toBe("stored");
    expect(res.id).not.toBe(original.id);
    const [after] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, original.id));
    expect(after!.lastError).toBe("permanent: Resent as a new email. 550 mailbox unavailable");
    await expect(resendFailedEmail(actor, { id: original.id, version: view!.version })).rejects.toMatchObject({ code: "conflict" });
    expect(await t.db.select({ id: emailOutbox.id }).from(emailOutbox)).toHaveLength(2);

    // The fresh version of the original resends again (a new copy each time the owner asks).
    const again = await loadOutboxEmail(actor, original.id);
    const second = await resendFailedEmail(actor, { id: original.id, version: again!.version });
    expect(second.id).not.toBe(res.id);
    expect(await t.db.select({ id: emailOutbox.id }).from(emailOutbox)).toHaveLength(3);
  });
});
