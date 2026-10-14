// "Send emails from your Gmail" on Integrations > Google Calendar: the read model for each state (owner only), the
// switch and account service (owner only, refused under EMAIL_PROVIDER, validated, audited, releases waiting emails),
// and the card's markup for each state (status line, switch, reconnect and consent links, waiting emails).
import { and, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));
vi.mock("@/lib/email/gmail-actions", () => ({ saveGmailSending: vi.fn() }));

const { auditLog, calendarConnections, emailOutbox, instanceSettings, jobs } = await import("@/db/schema");
const { loadActorCtx } = await import("@/lib/authz");
const email = await import("@/lib/email");
const { getGmailSendingView, gmailConsentHref, setGmailSending } = await import("@/lib/email/gmail-view");
const { GmailSendingCard } = await import("@/components/integrations/gmail-sending-card");
const { useTestDb } = await import("../helpers/db");
const { createUser } = await import("../factories");
const h = await import("./helpers");

type TestUser = Awaited<ReturnType<typeof createUser>>;
type View = NonNullable<Awaited<ReturnType<typeof getGmailSendingView>>>;

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const ENV_KEYS = ["RESEND_API_KEY", "SMTP_HOST", "EMAIL_PROVIDER"];

let owner: TestUser;
let member: TestUser;
const actorOf = (u: TestUser) => loadActorCtx(t.db, u);

beforeAll(async () => {
  owner = await createUser(t.db, { name: "Jordan Lee", email: "jordan@example.com", isInstanceAdmin: true });
  member = await createUser(t.db, { name: "Sam Member", email: "sam@example.com", organizationId: owner.organizationId });
});

beforeEach(async () => {
  for (const k of ENV_KEYS) delete env[k];
  env.GOOGLE_CLIENT_ID = "google-client";
  env.GOOGLE_CLIENT_SECRET = "google-secret";
  await t.db.delete(emailOutbox);
  await t.db.delete(jobs);
  await t.db.delete(instanceSettings);
  await t.db.delete(calendarConnections);
});

afterEach(() => {
  for (const k of [...ENV_KEYS, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) delete env[k];
});

const view = async (opts: { requested?: boolean } = {}) => (await getGmailSendingView(await actorOf(owner), opts))!;

describe("getGmailSendingView", () => {
  it("is only for the instance owner", async () => {
    await h.connectGoogle(t.db, member);
    expect(await getGmailSendingView(await actorOf(member))).toBeNull();
    expect(await getGmailSendingView(await actorOf(owner))).not.toBeNull();
  });

  it("not connected, then connected without gmail.send (consent link to that account), then on", async () => {
    expect(await view()).toMatchObject({ state: "not_connected", address: null, canEdit: false, allowHref: gmailConsentHref(null) });
    expect(gmailConsentHref(null)).toBe("/api/auth/google/start?intent=connect_calendar&next=%2Fapp%2Fintegrations%2Fcalendars%2Fgoogle%3Fgmail%3Drequested");
    const conn = await h.connectGoogle(t.db, owner, { address: "jordan.lee@gmail.com", scopes: h.CALENDAR_SCOPES });
    const needed = await view({ requested: true });
    expect(needed).toMatchObject({ state: "permission_needed", candidates: [], requested: "missing", canEdit: false });
    expect(needed.allowHref).toBe(gmailConsentHref({ id: conn.id }));
    expect(needed.allowHref).toContain(`reconnect=${conn.id}`);
    await t.db.update(calendarConnections).set({ scopes: h.GMAIL_SCOPES }).where(eq(calendarConnections.id, conn.id));
    expect(await view({ requested: true })).toMatchObject({
      state: "on",
      address: "jordan.lee@gmail.com",
      enabled: true,
      canEdit: true,
      selectedConnectionId: conn.id,
      candidates: [{ id: conn.id, address: "jordan.lee@gmail.com", status: "active" }],
      requested: "granted",
      heldCount: 0,
      lastFailure: null,
    });
  });

  it("off, needs a reconnect (with waiting emails), the last failure, and environment overrides", async () => {
    const conn = await h.connectGoogle(t.db, owner);
    await t.db.insert(instanceSettings).values({ key: email.EMAIL_PROVIDER_SETTING_KEY, value: "outbox" });
    expect(await view()).toMatchObject({ state: "off", enabled: false, canEdit: true });
    await t.db.delete(instanceSettings);

    await t.db.insert(emailOutbox).values({
      toAddresses: ["sam@example.com"],
      fromAddress: conn.address,
      subject: "Reminder",
      html: "<p>Hi</p>",
      text: "Hi",
      template: "workflows.reminder",
      category: "workflow",
      status: "failed",
      provider: "gmail",
      lastError: "permanent: Gmail refused to send this email (400 invalidArgument): Invalid To header",
      idempotencyKey: "failure-1",
    });
    expect((await view()).lastFailure?.message).toBe("Gmail refused to send this email (400 invalidArgument): Invalid To header");

    await t.db.update(calendarConnections).set({ status: "needs_reauth" }).where(eq(calendarConnections.id, conn.id));
    await email.sendEmail({ to: ["sam@example.com"], subject: "Hi", html: "<p>Hi</p>", text: "Hi", template: "t", category: "transactional", idempotencyKey: "held-1" });
    expect(await view()).toMatchObject({ state: "needs_reconnect", heldCount: 1, canEdit: true, allowHref: gmailConsentHref({ id: conn.id }) });

    env.RESEND_API_KEY = "re_test";
    expect(await view()).toMatchObject({ state: "other_provider", otherProvider: "resend", canEdit: false, lastFailure: null });
    env.EMAIL_PROVIDER = "outbox";
    expect(await view()).toMatchObject({ state: "forced_outbox", envProvider: "outbox", canEdit: false });
    env.EMAIL_PROVIDER = "gmail";
    await t.db.update(calendarConnections).set({ status: "active" }).where(eq(calendarConnections.id, conn.id));
    expect(await view()).toMatchObject({ state: "on", envProvider: "gmail", canEdit: false });
  });

  it("without the Google OAuth client and no account it is unavailable (no consent link)", async () => {
    delete env.GOOGLE_CLIENT_ID;
    expect(await view()).toMatchObject({ state: "unavailable", allowHref: null });
  });
});

describe("setGmailSending", () => {
  it("is refused for anyone but the owner, and while EMAIL_PROVIDER is set", async () => {
    await h.connectGoogle(t.db, owner);
    await expect(setGmailSending(await actorOf(member), { enabled: false })).rejects.toMatchObject({ code: "forbidden" });
    env.EMAIL_PROVIDER = "gmail";
    await expect(setGmailSending(await actorOf(owner), { enabled: false })).rejects.toMatchObject({ code: "conflict" });
    expect(await t.db.select().from(instanceSettings)).toHaveLength(0);
  });

  it("validates the account and needs gmail.send to turn it on", async () => {
    const calendarOnly = await h.connectGoogle(t.db, owner, { scopes: h.CALENDAR_SCOPES });
    await expect(setGmailSending(await actorOf(owner), { enabled: true })).rejects.toMatchObject({ code: "conflict" });
    await expect(setGmailSending(await actorOf(owner), { enabled: true, connectionId: calendarOnly.id })).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { connectionId: ["Choose one of your Google accounts that allows Gmail sending."] },
    });
    const othersConn = await h.connectGoogle(t.db, member, { address: "sam@gmail.com" });
    await expect(setGmailSending(await actorOf(owner), { enabled: true, connectionId: othersConn.id })).rejects.toMatchObject({ code: "validation" });
  });

  it("turns Gmail off and on, picks the account, audits, and releases waiting emails", async () => {
    const first = await h.connectGoogle(t.db, owner, { address: "first@gmail.com" });
    const second = await h.connectGoogle(t.db, owner, { address: "second@gmail.com" });
    const off = await setGmailSending(await actorOf(owner), { enabled: false });
    expect(off).toEqual({ enabled: false, connectionId: null, releasedJobIds: [] });
    expect(await email.resolveEmailTransport()).toMatchObject({ name: "outbox", source: "setting" });

    // An email waiting for Gmail (forced hold through a broken account) is released when Gmail is turned back on.
    await t.db.update(calendarConnections).set({ status: "needs_reauth" }).where(eq(calendarConnections.id, first.id));
    await t.db.delete(instanceSettings);
    await t.db.insert(instanceSettings).values({ key: email.GMAIL_SENDER_SETTING_KEY, value: first.id });
    const held = await email.sendEmail({ to: ["sam@example.com"], subject: "Hi", html: "<p>Hi</p>", text: "Hi", template: "t", category: "transactional", idempotencyKey: "held-2" });
    expect((await email.resolveEmailTransport()).hold).not.toBeNull();

    const on = await setGmailSending(await actorOf(owner), { enabled: true, connectionId: second.id });
    expect(on).toMatchObject({ enabled: true, connectionId: second.id });
    expect(on.releasedJobIds).toHaveLength(1);
    const [job] = await t.db.select().from(jobs).where(eq(jobs.idempotencyKey, `email.retry:${held.id}`));
    expect(job!.runAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(await email.resolveEmailTransport()).toMatchObject({ name: "gmail", gmail: { connectionId: second.id, address: "second@gmail.com" }, hold: null });
    const audits = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "email.gmail_sending_changed"), eq(auditLog.actorUserId, owner.id)));
    expect(audits.map((a) => a.details)).toEqual(expect.arrayContaining([{ from: "auto", to: "outbox" }, { from: "auto", to: "auto", connectionId: second.id }]));
  });
});

const render = (v: Partial<View>) =>
  renderToStaticMarkup(
    createElement(GmailSendingCard, {
      appName: "Kairos",
      view: {
        state: "on",
        address: "jordan.lee@gmail.com",
        candidates: [{ id: "00000000-0000-4000-8000-000000000001", address: "jordan.lee@gmail.com", status: "active" }],
        selectedConnectionId: "00000000-0000-4000-8000-000000000001",
        enabled: true,
        envProvider: null,
        otherProvider: null,
        canEdit: true,
        heldCount: 0,
        lastFailure: null,
        allowHref: "/api/auth/google/start?intent=connect_calendar",
        requested: null,
        ...v,
      },
    }),
  );

describe("GmailSendingCard", () => {
  it("on: the status line, the switch and the badge", () => {
    const html = render({});
    expect(html).toContain("Send emails from your Gmail");
    expect(html).toMatch(/Sending emails from <span[^>]*>jordan\.lee@gmail\.com<\/span>/);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(html).toContain(">On<");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("Reconnect Google");
    expect(html).not.toContain("<select");
  });

  it("needs a reconnect: the reconnect link and the waiting emails", () => {
    const html = render({ state: "needs_reconnect", heldCount: 3 });
    expect(html).toContain("Action required");
    expect(html).toContain("3 emails are waiting to be sent.");
    expect(html).toMatch(/<a href="\/api\/auth\/google\/start\?intent=connect_calendar"[^>]*>.*Reconnect Google/);
  });

  it("permission needed: the consent link and what the permission allows", () => {
    const html = render({ state: "permission_needed", candidates: [], address: null, selectedConnectionId: null, canEdit: false });
    expect(html).toContain("Allow Gmail sending");
    expect(html).toContain("Send email on your behalf");
    expect(html).toContain("it can&#x27;t read, change or delete your mail");
    expect(html).not.toContain('role="switch"');
  });

  it("several accounts: the Send from picker; read only under EMAIL_PROVIDER", () => {
    const html = render({
      candidates: [
        { id: "00000000-0000-4000-8000-000000000001", address: "jordan.lee@gmail.com", status: "active" },
        { id: "00000000-0000-4000-8000-000000000002", address: "work@example.com", status: "needs_reauth" },
      ],
      envProvider: "gmail",
      canEdit: false,
    });
    expect(html).toContain("Send from");
    expect(html).toContain("work@example.com (reconnect needed)");
    expect(html).toContain("Set by EMAIL_PROVIDER=gmail on this server.");
    expect(html).toMatch(/role="switch"[^>]*disabled=""/);
  });

  it("another provider and the outbox override explain the environment", () => {
    expect(render({ state: "other_provider", otherProvider: "smtp", canEdit: false })).toContain("Emails are sent with SMTP on this server (SMTP_HOST)");
    expect(render({ state: "forced_outbox", envProvider: "outbox", canEdit: false })).toContain("EMAIL_PROVIDER=outbox is set on this server");
    expect(render({ state: "off", enabled: false })).toContain("Emails are kept in the outbox and not sent.");
    expect(render({ requested: "missing", state: "permission_needed", candidates: [] })).toContain("Gmail sending wasn&#x27;t allowed.");
  });
});
