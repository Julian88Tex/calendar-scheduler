// Email outbox page read model and "Resend" on PGlite (golden-path-qa): who may open it, newest first with pagination
// (a tampered page number never fails the query), filters and search, the "Waiting for Gmail" and failure reasons
// without internal prefixes, the organization scope of an owner who is not an instance admin, and a resend that sends
// one new copy per state of the original (stale pages, double clicks, held and retrying emails are refused; a failed
// copy puts the original back so the same page can try again, still with one copy in all). outbox.pg.test.ts runs the
// same read model on real Postgres through postgres.js.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));
// "before": the copy is never made (the call fails first); "after": the copy row exists but the call still fails.
const resendFault = vi.hoisted(() => ({ next: null as "before" | "after" | null }));
vi.mock("@/lib/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...real,
    resendOutboxEmail: async (...args: Parameters<typeof real.resendOutboxEmail>) => {
      const fault = resendFault.next;
      resendFault.next = null;
      if (fault === "before") throw new Error("connection reset");
      const result = await real.resendOutboxEmail(...args);
      if (fault === "after") throw new Error("connection reset");
      return result;
    },
  };
});

const { emailOutbox } = await import("@/db/schema");
const { loadActorCtx } = await import("@/lib/authz");
const { GMAIL_HOLD_PREFIX } = await import("@/lib/email");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../../../../../../tests/helpers/db");
const { createUser } = await import("../../../../../../tests/factories");
const { canSeeEmailOutbox } = await import("./access");
const { lastOutboxPage, loadOutboxEmail, loadOutboxPage, resendFailedEmail, OUTBOX_MAX_PAGE, OUTBOX_PAGE_SIZE } = await import("./data");
const { cleanReason, outboxRowStatus, parseStatusFilter } = await import("./status");

type TestUser = Awaited<ReturnType<typeof createUser>>;

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;

let admin: TestUser;
let member: TestUser;
let otherOwner: TestUser;
const actorOf = (u: TestUser) => loadActorCtx(t.db, u);

let seq = 0;
async function row(over: Partial<typeof emailOutbox.$inferInsert> = {}) {
  seq++;
  const at = new Date(Date.UTC(2026, 9, 1, 12, 0, seq));
  const [r] = await t.db
    .insert(emailOutbox)
    .values({
      toAddresses: [`invitee${seq}@example.com`],
      fromAddress: "notifications@localhost",
      fromName: "Kairos",
      subject: `Subject ${seq}`,
      html: `<html><head><title>x</title></head><body><p>Body ${seq}</p></body></html>`,
      text: `Body ${seq}`,
      template: "lifecycle.invitee_confirmation",
      category: "transactional",
      status: "sent",
      provider: "resend",
      attempts: 1,
      idempotencyKey: `test:${seq}:${Math.random()}`,
      organizationId: admin.organizationId,
      createdAt: at,
      updatedAt: at,
      ...over,
    })
    .returning();
  return r!;
}

beforeAll(async () => {
  admin = await createUser(t.db, { name: "Owner One", email: "owner1@example.com", isInstanceAdmin: true });
  member = await createUser(t.db, { name: "Member", email: "member@example.com", organizationId: admin.organizationId });
  otherOwner = await createUser(t.db, { name: "Other Owner", email: "other@example.com" });
});

beforeEach(async () => {
  for (const k of ["RESEND_API_KEY", "SMTP_HOST", "EMAIL_PROVIDER"]) delete env[k];
  resetFakeTime();
  await t.db.delete(emailOutbox);
});

describe("status", () => {
  it("strips the internal prefixes and labels holds", () => {
    expect(cleanReason("permanent: gave up after 8 attempts: 550 mailbox unavailable")).toBe("Gave up after 8 attempts: 550 mailbox unavailable");
    expect(cleanReason(`${GMAIL_HOLD_PREFIX}Your Google account needs a reconnect.`)).toBe("Your Google account needs a reconnect.");
    expect(cleanReason(null)).toBeNull();
    const held = outboxRowStatus({ status: "failed", attempts: 0, lastError: `${GMAIL_HOLD_PREFIX}Reconnect it.` });
    expect(held).toMatchObject({ kind: "waiting_gmail", label: "Waiting for Gmail", reason: "Reconnect it.", canResend: false });
    expect(outboxRowStatus({ status: "failed", attempts: 2, lastError: "Resend: 503" })).toMatchObject({ kind: "failed", retrying: true, canResend: false });
    expect(outboxRowStatus({ status: "failed", attempts: 1, lastError: "permanent: 422 invalid" })).toMatchObject({ kind: "failed", retrying: false, canResend: true, reason: "422 invalid" });
    expect(outboxRowStatus({ status: "sending", attempts: 1, lastError: null }).kind).toBe("queued");
    expect(outboxRowStatus({ status: "stored", attempts: 0, lastError: null }).label).toBe("Stored");
    expect(parseStatusFilter("waiting_gmail")).toBe("waiting_gmail");
    expect(parseStatusFilter("nope")).toBe("all");
  });
});

describe("access", () => {
  it("instance admins and organization owners, nobody else", async () => {
    expect(canSeeEmailOutbox(await actorOf(admin))).toBe(true);
    expect(canSeeEmailOutbox(await actorOf(otherOwner))).toBe(true);
    expect(canSeeEmailOutbox(await actorOf(member))).toBe(false);
    await expect(loadOutboxPage(await actorOf(member), { status: "all", q: "", page: 1 })).rejects.toMatchObject({ code: "not_found" });
  });

  it("an organization owner who is not an instance admin sees only their organization's emails", async () => {
    await row({ subject: "Ours" });
    await row({ subject: "Theirs", organizationId: otherOwner.organizationId });
    await row({ subject: "System", organizationId: null });
    const mine = await loadOutboxPage(await actorOf(otherOwner), { status: "all", q: "", page: 1 });
    expect(mine.rows.map((r) => r.subject)).toEqual(["Theirs"]);
    const all = await loadOutboxPage(await actorOf(admin), { status: "all", q: "", page: 1 });
    expect(all.rows.map((r) => r.subject)).toEqual(["System", "Theirs", "Ours"]);
    const ours = (await t.db.select().from(emailOutbox).where(eq(emailOutbox.subject, "Ours")))[0]!;
    expect(await loadOutboxEmail(await actorOf(otherOwner), ours.id)).toBeNull();
    expect((await loadOutboxEmail(await actorOf(admin), ours.id))?.html).toContain("Body");
  });
});

describe("loadOutboxPage", () => {
  it("lists newest first in pages of 25 with the total", async () => {
    for (let i = 0; i < OUTBOX_PAGE_SIZE + 3; i++) await row();
    const actor = await actorOf(admin);
    const p1 = await loadOutboxPage(actor, { status: "all", q: "", page: 1 });
    expect(p1.rows).toHaveLength(OUTBOX_PAGE_SIZE);
    expect(p1.total).toBe(OUTBOX_PAGE_SIZE + 3);
    expect(p1.hasMore).toBe(true);
    const times = p1.rows.map((r) => Date.parse(r.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const p2 = await loadOutboxPage(actor, { status: "all", q: "", page: 2 });
    expect(p2.rows).toHaveLength(3);
    expect(p2.hasMore).toBe(false);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(OUTBOX_PAGE_SIZE + 3);
    expect(p1.transport).toBe("Stored in the outbox (no email provider configured)");
  });

  it("a page number from a tampered or stale URL never fails the query (offset beyond bigint)", async () => {
    await row();
    const actor = await actorOf(admin);
    for (const page of [1e18, 9_007_199_254_740_993, 4e6]) {
      const p = await loadOutboxPage(actor, { status: "all", q: "", page });
      expect(p.rows).toHaveLength(0);
      expect(p.total).toBe(1);
      expect(p.page).toBe(OUTBOX_MAX_PAGE);
    }
    expect(lastOutboxPage(0)).toBe(1);
    expect(lastOutboxPage(OUTBOX_PAGE_SIZE)).toBe(1);
    expect(lastOutboxPage(OUTBOX_PAGE_SIZE + 1)).toBe(2);
  });

  it("filters by status and searches recipients, subjects and templates", async () => {
    await row({ status: "sent", subject: "Confirmed: 30 Minute Virtual" });
    await row({ status: "stored", provider: "outbox", attempts: 0 });
    await row({ status: "failed", provider: "gmail", attempts: 0, lastError: `${GMAIL_HOLD_PREFIX}Reconnect it.` });
    await row({ status: "failed", attempts: 1, lastError: "permanent: 422 invalid recipient", toAddresses: ["sam@example.com"] });
    await row({ status: "sending" });
    const actor = await actorOf(admin);
    const by = async (status: Parameters<typeof loadOutboxPage>[1]["status"], q = "") => (await loadOutboxPage(actor, { status, q, page: 1 })).rows;
    expect((await by("sent")).map((r) => r.subject)).toEqual(["Confirmed: 30 Minute Virtual"]);
    expect(await by("stored")).toHaveLength(1);
    expect(await by("queued")).toHaveLength(1);
    const waiting = await by("waiting_gmail");
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.status).toMatchObject({ label: "Waiting for Gmail", reason: "Reconnect it." });
    const failed = await by("failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.status.reason).toBe("422 invalid recipient");
    expect((await by("all", "SAM@example")).map((r) => r.to)).toEqual([["sam@example.com"]]);
    expect(await by("all", "30 minute")).toHaveLength(1);
    expect(await by("all", "invitee_confirmation")).toHaveLength(5);
    expect(await by("all", "100%_")).toHaveLength(0);
    expect((await loadOutboxPage(actor, { status: "all", q: "", page: 1 })).waitingForGmail).toBe(1);
  });
});

describe("resendFailedEmail", () => {
  it("sends one new copy and marks the original as resent", async () => {
    setFakeNow(new Date("2026-10-02T12:00:00Z"));
    const original = await row({ status: "failed", attempts: 1, lastError: "permanent: 422 invalid", subject: "Reminder: 30 Minute Virtual" });
    const actor = await actorOf(admin);
    const res = await resendFailedEmail(actor, { id: original.id, version: original.updatedAt.toISOString() });
    expect(res.status).toBe("stored"); // no email provider in tests: the copy is kept in the outbox
    expect(res.id).not.toBe(original.id);
    const [copy] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, res.id));
    expect(copy).toMatchObject({ subject: "Reminder: 30 Minute Virtual", toAddresses: original.toAddresses, template: original.template });
    const [after] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, original.id));
    expect(after!.lastError).toBe("permanent: Resent as a new email. 422 invalid");
    expect(outboxRowStatus(after!)).toMatchObject({ kind: "failed", canResend: true, reason: "Resent as a new email. 422 invalid" });

    // The same (now stale) version again: refused, no second copy.
    await expect(resendFailedEmail(actor, { id: original.id, version: original.updatedAt.toISOString() })).rejects.toMatchObject({ code: "conflict" });
    expect(await t.db.select().from(emailOutbox)).toHaveLength(2);
  });

  it("puts the original back when the copy fails, and a retry from the same page makes exactly one copy", async () => {
    const actor = await actorOf(admin);
    for (const fault of ["before", "after"] as const) {
      await t.db.delete(emailOutbox);
      const original = await row({ status: "failed", attempts: 1, lastError: "permanent: 422 invalid" });
      const version = original.updatedAt.toISOString();
      resendFault.next = fault;
      await expect(resendFailedEmail(actor, { id: original.id, version })).rejects.toThrow("connection reset");
      const [back] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, original.id));
      expect(back!.lastError, fault).toBe("permanent: 422 invalid");
      expect(back!.updatedAt.getTime(), fault).toBe(original.updatedAt.getTime());
      expect(outboxRowStatus(back!).canResend).toBe(true);
      expect(await t.db.select().from(emailOutbox), fault).toHaveLength(fault === "before" ? 1 : 2);
      // "Resend" again on the same (unchanged) page: one copy in all.
      const res = await resendFailedEmail(actor, { id: original.id, version });
      expect(res.id).not.toBe(original.id);
      expect(await t.db.select().from(emailOutbox), fault).toHaveLength(2);
    }
  });

  it("refuses held, retrying, sent and purged emails, and other organizations' emails", async () => {
    const actor = await actorOf(admin);
    const held = await row({ status: "failed", attempts: 0, lastError: `${GMAIL_HOLD_PREFIX}Reconnect it.` });
    const retrying = await row({ status: "failed", attempts: 2, lastError: "Resend: 503" });
    const sent = await row({ status: "sent" });
    const purged = await row({ status: "failed", attempts: 1, lastError: "permanent: x", html: "", text: "", bodyPurgedAt: new Date() });
    const theirs = await row({ status: "failed", attempts: 1, lastError: "permanent: x", organizationId: otherOwner.organizationId });
    for (const r of [held, retrying, sent, purged]) {
      await expect(resendFailedEmail(actor, { id: r.id, version: r.updatedAt.toISOString() })).rejects.toMatchObject({ code: "conflict" });
    }
    await expect(resendFailedEmail(await actorOf(member), { id: theirs.id, version: theirs.updatedAt.toISOString() })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(resendFailedEmail(await actorOf(otherOwner), { id: held.id, version: held.updatedAt.toISOString() })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await t.db.select().from(emailOutbox)).toHaveLength(5);
  });
});
