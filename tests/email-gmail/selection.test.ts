// Transport selection (src/lib/email/gmail-sender.ts): RESEND_API_KEY, then SMTP_HOST, then the owner's Gmail (the
// first instance admin's Google connection that granted gmail.send, unless the owner turned it off), else the outbox;
// EMAIL_PROVIDER=gmail|resend|smtp|outbox forces a choice (ignored when unusable or invalid). Which connection sends:
// the owner's pick, else an active one, else the login address, else the oldest.
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { calendarConnections, emailOutbox, instanceSettings, jobs } = await import("@/db/schema");
const email = await import("@/lib/email");
const sender = await import("@/lib/email/gmail-sender");
const { useTestDb } = await import("../helpers/db");
const { createUser } = await import("../factories");
const h = await import("./helpers");

type TestUser = Awaited<ReturnType<typeof createUser>>;

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const ENV_KEYS = ["RESEND_API_KEY", "SMTP_HOST", "EMAIL_PROVIDER"];

let owner: TestUser;
let laterAdmin: TestUser;

beforeAll(async () => {
  owner = await createUser(t.db, { name: "Jordan Lee", email: "jordan@example.com", isInstanceAdmin: true });
  // A second instance admin created later (ADMIN_EMAILS style): never the sender.
  laterAdmin = await createUser(t.db, { name: "Alex Admin", email: "alex@example.com", isInstanceAdmin: true, overrides: { createdAt: new Date(Date.now() + 60_000) } });
});

beforeEach(async () => {
  for (const k of ENV_KEYS) delete env[k];
  await t.db.delete(emailOutbox);
  await t.db.delete(jobs);
  await t.db.delete(instanceSettings);
  await t.db.delete(calendarConnections);
});

afterEach(() => {
  for (const k of ENV_KEYS) delete env[k];
  vi.restoreAllMocks();
});

const resolve = () => email.resolveEmailTransport();

describe("selection order", () => {
  it("Resend, then SMTP, then the owner's Gmail, else the outbox", async () => {
    const conn = await h.connectGoogle(t.db, owner, { address: "jordan.lee@gmail.com" });
    env.RESEND_API_KEY = "re_test";
    env.SMTP_HOST = "smtp.example.com";
    expect(await resolve()).toMatchObject({ name: "resend", source: "configured", gmail: null });
    expect(email.emailTransportName()).toBe("resend");
    delete env.RESEND_API_KEY;
    expect(await resolve()).toMatchObject({ name: "smtp", source: "configured" });
    expect(email.emailTransportName()).toBe("smtp");
    delete env.SMTP_HOST;
    expect(await resolve()).toEqual({
      name: "gmail",
      source: "gmail",
      hold: null,
      gmail: { ownerUserId: owner.id, ownerName: "Jordan Lee", connectionId: conn.id, address: "jordan.lee@gmail.com", connectionStatus: "active" },
    });
    // The synchronous name only sees the environment.
    expect(email.emailTransportName()).toBe("outbox");
    await t.db.delete(calendarConnections);
    expect(await resolve()).toMatchObject({ name: "outbox", source: "none", gmail: null, hold: null });
  });

  it("EMAIL_PROVIDER forces a transport, and is ignored when unusable or invalid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await h.connectGoogle(t.db, owner);
    env.RESEND_API_KEY = "re_test";
    env.SMTP_HOST = "smtp.example.com";
    env.EMAIL_PROVIDER = "gmail";
    expect(await resolve()).toMatchObject({ name: "gmail", source: "forced", hold: null });
    expect(email.emailTransportName()).toBe("gmail");
    env.EMAIL_PROVIDER = "smtp";
    expect(await resolve()).toMatchObject({ name: "smtp", source: "forced" });
    env.EMAIL_PROVIDER = "OUTBOX";
    expect(await resolve()).toMatchObject({ name: "outbox", source: "forced" });
    delete env.RESEND_API_KEY;
    delete env.SMTP_HOST;
    env.EMAIL_PROVIDER = "resend";
    expect(await resolve()).toMatchObject({ name: "gmail", source: "gmail" });
    env.EMAIL_PROVIDER = "carrier-pigeon";
    expect(await resolve()).toMatchObject({ name: "gmail", source: "gmail" });
    expect(sender.emailProviderFromEnv()).toBeNull();
    const events = warn.mock.calls.map((c) => (JSON.parse(String(c[0])) as { event: string }).event);
    expect(events).toContain("email.email_provider_unusable");
    expect(events).toContain("email.invalid_email_provider");
  });

  it("EMAIL_PROVIDER=gmail before Google is connected holds emails until it is", async () => {
    env.EMAIL_PROVIDER = "gmail";
    const r = await resolve();
    expect(r).toMatchObject({ name: "gmail", source: "forced", gmail: null });
    expect(r.hold).toContain("Gmail sending is not set up yet");
    const sent = await email.sendEmail({
      to: ["sam@example.com"],
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      template: "test",
      category: "transactional",
      idempotencyKey: "forced-gmail-not-connected",
    });
    expect(sent.status).toBe("failed");
    const [row] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, sent.id));
    expect(email.isHeldForGmail(row!)).toBe(true);
  });

  it("the owner can turn Gmail sending off; EMAIL_PROVIDER=gmail overrides that", async () => {
    await h.connectGoogle(t.db, owner);
    await t.db.insert(instanceSettings).values({ key: email.EMAIL_PROVIDER_SETTING_KEY, value: "outbox" });
    expect(await resolve()).toMatchObject({ name: "outbox", source: "setting" });
    await t.db.update(instanceSettings).set({ value: "auto" }).where(eq(instanceSettings.key, email.EMAIL_PROVIDER_SETTING_KEY));
    expect(await resolve()).toMatchObject({ name: "gmail" });
    await t.db.update(instanceSettings).set({ value: "outbox" }).where(eq(instanceSettings.key, email.EMAIL_PROVIDER_SETTING_KEY));
    env.EMAIL_PROVIDER = "gmail";
    expect(await resolve()).toMatchObject({ name: "gmail", source: "forced" });
  });
});

describe("the sending account", () => {
  it("is the first instance admin's: another admin's Gmail never sends", async () => {
    await h.connectGoogle(t.db, laterAdmin, { address: "alex@gmail.com" });
    expect(await sender.getInstanceOwner()).toMatchObject({ id: owner.id });
    expect(await resolve()).toMatchObject({ name: "outbox", source: "none" });
    await h.connectGoogle(t.db, owner, { address: "jordan.lee@gmail.com" });
    expect((await resolve()).gmail?.address).toBe("jordan.lee@gmail.com");
  });

  it("needs gmail.send; a connection that needs a reconnect holds; a disconnected one is ignored", async () => {
    const calendarOnly = await h.connectGoogle(t.db, owner, { scopes: h.CALENDAR_SCOPES });
    expect(await resolve()).toMatchObject({ name: "outbox", source: "none" });
    await t.db.update(calendarConnections).set({ scopes: h.GMAIL_SCOPES, status: "needs_reauth" }).where(eq(calendarConnections.id, calendarOnly.id));
    const held = await resolve();
    expect(held).toMatchObject({ name: "gmail", gmail: { connectionId: calendarOnly.id, connectionStatus: "needs_reauth" } });
    expect(held.hold).toBe(sender.reconnectHoldReason(calendarOnly.address));
    await t.db.update(calendarConnections).set({ status: "disconnected" }).where(eq(calendarConnections.id, calendarOnly.id));
    expect(await resolve()).toMatchObject({ name: "outbox", source: "none" });
  });

  it("is the owner's pick, else an active one, else the login address, else the oldest", async () => {
    const oldest = await h.connectGoogle(t.db, owner, { address: "old@gmail.com" });
    const login = await h.connectGoogle(t.db, owner, { address: "Jordan@Example.com" });
    const other = await h.connectGoogle(t.db, owner, { address: "other@gmail.com" });
    expect((await resolve()).gmail?.connectionId).toBe(login.id);
    await t.db.update(calendarConnections).set({ status: "needs_reauth" }).where(eq(calendarConnections.id, login.id));
    expect((await resolve()).gmail?.connectionId).toBe(oldest.id);
    await t.db.insert(instanceSettings).values({ key: email.GMAIL_SENDER_SETTING_KEY, value: other.id });
    expect((await resolve()).gmail?.connectionId).toBe(other.id);
    // A pick that no longer allows sending falls back to the order above.
    await t.db.update(calendarConnections).set({ scopes: h.CALENDAR_SCOPES }).where(eq(calendarConnections.id, other.id));
    expect((await resolve()).gmail?.connectionId).toBe(oldest.id);
  });

  it("describes the transport in one line for status tiles", async () => {
    expect(email.describeEmailTransport(await resolve())).toBe("Stored in the outbox (no email provider configured)");
    const conn = await h.connectGoogle(t.db, owner, { address: "jordan.lee@gmail.com" });
    expect(email.describeEmailTransport(await resolve())).toBe("Sending from jordan.lee@gmail.com (Gmail)");
    await t.db.update(calendarConnections).set({ status: "needs_reauth" }).where(eq(calendarConnections.id, conn.id));
    expect(email.describeEmailTransport(await resolve())).toBe("Waiting for Gmail: reconnect jordan.lee@gmail.com");
    await t.db.insert(instanceSettings).values({ key: email.EMAIL_PROVIDER_SETTING_KEY, value: "outbox" });
    expect(email.describeEmailTransport(await resolve())).toBe("Stored in the outbox (Gmail sending is turned off)");
    env.SMTP_HOST = "smtp.example.com";
    expect(email.describeEmailTransport(await resolve())).toBe("Sending with SMTP");
    env.EMAIL_PROVIDER = "outbox";
    expect(email.describeEmailTransport(await resolve())).toBe("Stored in the outbox (EMAIL_PROVIDER=outbox)");
  });

  it("pickGmailConnection ranks without touching the database", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m));
    const list = [
      { id: "a", address: "a@gmail.com", status: "needs_reauth" as const, hasGmailSend: true, createdAt: at(1) },
      { id: "b", address: "b@gmail.com", status: "active" as const, hasGmailSend: false, createdAt: at(2) },
      { id: "c", address: "c@gmail.com", status: "error" as const, hasGmailSend: true, createdAt: at(3) },
      { id: "d", address: "owner@gmail.com", status: "active" as const, hasGmailSend: true, createdAt: at(4) },
    ];
    expect(sender.pickGmailConnection(list)?.id).toBe("c");
    expect(sender.pickGmailConnection(list, { ownerEmail: "OWNER@gmail.com" })?.id).toBe("d");
    expect(sender.pickGmailConnection(list, { preferredId: "a" })?.id).toBe("a");
    expect(sender.pickGmailConnection(list, { preferredId: "b" })?.id).toBe("c");
    expect(sender.pickGmailConnection(list.filter((c) => !c.hasGmailSend))).toBeNull();
  });
});
