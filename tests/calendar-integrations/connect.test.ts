// Connecting and disconnecting Google Calendar on PGlite (SPEC CAL-01, CAL-06, CAL-07, CAL-08, CAL-16, CAL-17,
// GEN-08, GEN-17): sign-in creates one connection with the primary calendar checked and set as destination
// (idempotent, refresh token kept, Microsoft ignored, an explicit disconnect respected), the connect intent adds a
// second account, calendar lists sync (new calendars unchecked, removed ones dropped, duplicates across accounts
// listed once), disconnect clears credentials, cache and destination and revokes the token in a job, settings writes
// check ownership (another user's calendar answers 403), audit entries for connect and disconnect.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { auditLog, calendarConnections, calendars, externalEvents, jobs, oauthAccounts, users } = await import("@/db/schema");
const { decrypt } = await import("@/lib/crypto");
const { log } = await import("@/lib/logger");
const conn = await import("@/lib/calendars/connections");
const { handleConnectCallback } = await import("@/lib/calendars/oauth-connect");
const { handlers } = await import("@/lib/calendars/job-handlers");
const { addExternalBusy, createUser } = await import("../factories");
const { mockFetch } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { setupGoogle } = await import("./helpers");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];
const G = "https://www.googleapis.com/calendar/v3";

type Cal = { id: string; summary: string; primary?: boolean; accessRole?: string; backgroundColor?: string };
let calendarList: Cal[] = [];
let f: ReturnType<typeof mockFetch>;

beforeEach(() => {
  env.GOOGLE_CLIENT_ID = "google-client";
  env.GOOGLE_CLIENT_SECRET = "google-secret";
  calendarList = [
    { id: "me@gmail.com", summary: "me@gmail.com", primary: true, accessRole: "owner", backgroundColor: "#9fe1e7" },
    { id: "family@group.calendar.google.com", summary: "Family", accessRole: "writer" },
    { id: "holidays@group.v.calendar.google.com", summary: "Holidays", accessRole: "reader" },
  ];
  f = mockFetch(
    { method: "GET", url: `${G}/users/me/calendarList`, handler: () => ({ items: calendarList }) },
    { method: "POST", url: "https://oauth2.googleapis.com/revoke", handler: () => ({}) },
  );
});
afterEach(() => {
  f.restore();
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
});

const tokens = (over: Partial<{ refreshToken: string | null; scopes: string[] }> = {}) => ({
  accessToken: `at-${Math.random()}`,
  refreshToken: "refresh-1",
  expiresAt: new Date(Date.now() + 3_600_000),
  scopes: SCOPES,
  ...over,
});

/** An oauth_accounts row for a sign-in (foundation-auth creates it before linkCalendarFromOAuth). */
async function oauthAccount(userId: string, sub: string, email: string): Promise<string> {
  const [row] = await t.db.insert(oauthAccounts).values({ userId, provider: "google", providerAccountId: sub, email, emailNormalized: email }).returning({ id: oauthAccounts.id });
  return row!.id;
}

async function connections(userId: string) {
  return t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId));
}
async function calendarsOf(connectionId: string) {
  return t.db.select().from(calendars).where(eq(calendars.connectionId, connectionId));
}
async function destinationOf(userId: string) {
  const [u] = await t.db.select({ dest: users.destinationCalendarId }).from(users).where(eq(users.id, userId));
  return u?.dest ?? null;
}

describe("linkCalendarFromOAuth (CAL-17)", () => {
  it("creates one connection with the primary calendar checked and set as destination, idempotently", async () => {
    const user = await createUser(t.db);
    const p = { userId: user.id, provider: "google" as const, providerAccountId: "sub-1", accountEmail: "me@gmail.com", oauthAccountId: "00000000-0000-4000-8000-000000000001", tokens: tokens() };
    await t.db.insert(oauthAccounts).values({ id: p.oauthAccountId, userId: user.id, provider: "google", providerAccountId: "sub-1", email: "me@gmail.com", emailNormalized: "me@gmail.com" });
    await conn.linkCalendarFromOAuth(p);
    let rows = await connections(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "google", status: "active", accountEmail: "me@gmail.com", oauthAccountId: p.oauthAccountId });
    expect(await decrypt(rows[0]!.refreshTokenEnc!)).toBe("refresh-1");
    expect(rows[0]!.accessTokenEnc).not.toContain("at-");
    const cals = await calendarsOf(rows[0]!.id);
    expect(cals.map((c) => [c.externalId, c.checkConflicts, c.canWrite]).sort()).toEqual([
      ["family@group.calendar.google.com", false, true],
      ["holidays@group.v.calendar.google.com", false, false],
      ["me@gmail.com", true, true],
    ]);
    expect(await destinationOf(user.id)).toBe(cals.find((c) => c.isPrimary)!.id);

    // A second sign-in without a refresh token keeps the stored one and creates nothing new.
    await conn.linkCalendarFromOAuth({ ...p, tokens: tokens({ refreshToken: null }) });
    rows = await connections(user.id);
    expect(rows).toHaveLength(1);
    expect(await decrypt(rows[0]!.refreshTokenEnc!)).toBe("refresh-1");
    expect(await calendarsOf(rows[0]!.id)).toHaveLength(3);
    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "calendar.connected"), eq(auditLog.targetId, rows[0]!.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ namespace: "calendars", details: { provider: "google", via: "sign_in" } });
  });

  it("ignores Microsoft and grants without calendar scopes, and respects an explicit disconnect", async () => {
    const user = await createUser(t.db);
    const base = { userId: user.id, providerAccountId: "sub-2", accountEmail: "x@gmail.com", oauthAccountId: await oauthAccount(user.id, "sub-2", "x@gmail.com") };
    await conn.linkCalendarFromOAuth({ ...base, provider: "microsoft", tokens: tokens() });
    await conn.linkCalendarFromOAuth({ ...base, provider: "google", tokens: tokens({ scopes: ["openid", "email"] }) });
    expect(await connections(user.id)).toHaveLength(0);
    await conn.linkCalendarFromOAuth({ ...base, provider: "google", tokens: tokens() });
    const [row] = await connections(user.id);
    await conn.disconnectConnection({ user }, row!.id);
    await conn.linkCalendarFromOAuth({ ...base, provider: "google", tokens: tokens() });
    const rows = await connections(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("disconnected");
  });

  it("keeps an explicit None destination through later sign-ins; an explicit connect still sets one (CAL-08)", async () => {
    const user = await createUser(t.db);
    const p = { userId: user.id, provider: "google" as const, providerAccountId: "sub-none", accountEmail: "me@gmail.com", oauthAccountId: await oauthAccount(user.id, "sub-none", "me@gmail.com"), tokens: tokens() };
    await conn.linkCalendarFromOAuth(p);
    expect(await destinationOf(user.id)).not.toBeNull();
    await conn.setDestinationCalendar({ user }, null);
    // A routine sign-in, and a first sign-in with another Google account, leave "None" alone.
    await conn.linkCalendarFromOAuth({ ...p, tokens: tokens({ refreshToken: null }) });
    expect(await destinationOf(user.id)).toBeNull();
    calendarList = [{ id: "other@gmail.com", summary: "other@gmail.com", primary: true, accessRole: "owner" }];
    await conn.linkCalendarFromOAuth({ ...p, providerAccountId: "sub-none-2", accountEmail: "other@gmail.com", oauthAccountId: await oauthAccount(user.id, "sub-none-2", "other@gmail.com") });
    expect(await destinationOf(user.id)).toBeNull();
    const [u] = await t.db.select({ prefs: users.preferences }).from(users).where(eq(users.id, user.id));
    expect(u?.prefs).toMatchObject({ [conn.DESTINATION_NONE_PREF]: true });
    // Connecting an account on purpose (Calendar settings) picks its primary calendar and forgets the choice.
    calendarList = [{ id: "work@company.com", summary: "Work", primary: true, accessRole: "owner" }];
    const res = await conn.connectGoogleAccount({ userId: user.id, providerAccountId: "sub-none-3", accountEmail: "work@company.com", tokens: tokens(), via: "connect" });
    expect(res.destinationSet).toBe(true);
    const [work] = await calendarsOf(res.connectionId);
    expect(await destinationOf(user.id)).toBe(work!.id);
    const [after] = await t.db.select({ prefs: users.preferences }).from(users).where(eq(users.id, user.id));
    expect(after?.prefs?.[conn.DESTINATION_NONE_PREF]).toBeUndefined();
  });

  it("falls back to the account's primary calendar when the list cannot be read", async () => {
    f.add({ method: "GET", url: `${G}/users/me/calendarList`, handler: () => new Response(JSON.stringify({ error: { code: 503 } }), { status: 503 }) });
    const user = await createUser(t.db);
    await conn.linkCalendarFromOAuth({ userId: user.id, provider: "google", providerAccountId: "sub-3", accountEmail: "fallback@gmail.com", oauthAccountId: await oauthAccount(user.id, "sub-3", "fallback@gmail.com"), tokens: tokens() });
    const [row] = await connections(user.id);
    const cals = await calendarsOf(row!.id);
    expect(cals).toEqual([expect.objectContaining({ externalId: "fallback@gmail.com", isPrimary: true, checkConflicts: true, canWrite: true })]);
    expect(await destinationOf(user.id)).toBe(cals[0]!.id);
    const refresh = await t.db.select().from(jobs).where(eq(jobs.type, "calendars.refresh_calendar_list"));
    expect(refresh.some((j) => (j.payload as { connectionId: string }).connectionId === row!.id)).toBe(true);
  });
});

describe("handleConnectCallback (connect_calendar)", () => {
  const ctxFor = (userId: string, accountId: string, email: string, over: Record<string, unknown> = {}) => ({
    request: new Request("http://localhost:3000/api/auth/google/callback"),
    provider: "google" as const,
    intent: "connect_calendar" as const,
    tokens: { ...tokens(), idToken: null },
    profile: { providerAccountId: accountId, email, emailVerified: true, name: "Me", avatarUrl: null },
    state: { intent: "connect_calendar" as const, returnTo: null, data: {} as Record<string, string> },
    returnTo: null,
    userId,
    ...over,
  });

  it("adds a second Google account with its own calendars and keeps the first destination", async () => {
    const user = await createUser(t.db);
    const first = await handleConnectCallback(ctxFor(user.id, "acct-a", "me@gmail.com"));
    expect(first.status).toBe(303);
    expect(new URL(first.headers.get("location")!).pathname).toBe("/app/availability/calendar-settings");
    expect(new URL(first.headers.get("location")!).searchParams.get("connected")).toBe("google");
    const dest = await destinationOf(user.id);
    calendarList = [{ id: "work@company.com", summary: "work@company.com", primary: true, accessRole: "owner" }];
    await handleConnectCallback(ctxFor(user.id, "acct-b", "work@company.com"));
    const rows = await connections(user.id);
    expect(rows.map((r) => r.accountEmail).sort()).toEqual(["me@gmail.com", "work@company.com"]);
    const second = rows.find((r) => r.accountEmail === "work@company.com")!;
    expect((await calendarsOf(second.id)).map((c) => [c.externalId, c.checkConflicts])).toEqual([["work@company.com", true]]);
    expect(await destinationOf(user.id)).toBe(dest);
  });

  it("asks for the calendar permissions and reports a reconnect with another account", async () => {
    const user = await createUser(t.db);
    const denied = await handleConnectCallback(ctxFor(user.id, "acct-c", "me@gmail.com", { tokens: { ...tokens({ scopes: ["openid", "email"] }), idToken: null } }));
    expect(new URL(denied.headers.get("location")!).searchParams.get("calendar_error")).toBe("permissions");
    expect(await connections(user.id)).toHaveLength(0);
    const g = await setupGoogle(t.db, { user, status: "needs_reauth" });
    const res = await handleConnectCallback(ctxFor(user.id, "acct-other", "other@gmail.com", { state: { intent: "connect_calendar", returnTo: null, data: { reconnect: g.connectionId } } }));
    expect(new URL(res.headers.get("location")!).searchParams.get("reconnect_mismatch")).toBe("1");
  });

  it("reconnects a broken connection in place, keeping its settings", async () => {
    const user = await createUser(t.db);
    await handleConnectCallback(ctxFor(user.id, "acct-d", "me@gmail.com"));
    const [row] = await connections(user.id);
    const family = (await calendarsOf(row!.id)).find((c) => c.externalId === "family@group.calendar.google.com")!;
    await conn.setConflictCalendars({ user }, [{ calendarId: family.id, checked: true }]);
    await t.db.update(calendarConnections).set({ status: "needs_reauth", lastError: "invalid_grant" }).where(eq(calendarConnections.id, row!.id));
    await handleConnectCallback(ctxFor(user.id, "acct-d", "me@gmail.com", { state: { intent: "connect_calendar", returnTo: null, data: { reconnect: row!.id } } }));
    const rows = await connections(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: row!.id, status: "active", lastError: null });
    expect((await calendarsOf(row!.id)).find((c) => c.id === family.id)?.checkConflicts).toBe(true);
    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "calendar.reconnected"), eq(auditLog.targetId, row!.id)));
    expect(audits).toHaveLength(1);
  });
});

describe("calendar list sync (CAL-06, CAL-07)", () => {
  it("adds new calendars unchecked, drops removed ones (and the destination) and lists a shared calendar once", async () => {
    const user = await createUser(t.db);
    await conn.linkCalendarFromOAuth({ userId: user.id, provider: "google", providerAccountId: "sub-s", accountEmail: "me@gmail.com", oauthAccountId: await oauthAccount(user.id, "sub-s", "me@gmail.com"), tokens: tokens() });
    const [row] = await connections(user.id);
    const family = (await calendarsOf(row!.id)).find((c) => c.externalId === "family@group.calendar.google.com")!;
    await conn.setDestinationCalendar({ user }, family.id);
    calendarList = [
      { id: "me@gmail.com", summary: "me@gmail.com", primary: true, accessRole: "owner" },
      { id: "book-club@group.calendar.google.com", summary: "Book club", accessRole: "owner" },
      { id: "holidays@group.v.calendar.google.com", summary: "Holidays", accessRole: "reader" },
    ];
    await conn.syncCalendarList(row!.id);
    const cals = await calendarsOf(row!.id);
    expect(cals.find((c) => c.externalId === "book-club@group.calendar.google.com")?.checkConflicts).toBe(false);
    expect(cals.find((c) => c.externalId === "family@group.calendar.google.com")?.deletedAt).not.toBeNull();
    expect(await destinationOf(user.id)).toBeNull();
    // A second account that also sees "Book club" does not list it again.
    calendarList = [
      { id: "other@gmail.com", summary: "other@gmail.com", primary: true, accessRole: "owner" },
      { id: "book-club@group.calendar.google.com", summary: "Book club", accessRole: "reader" },
    ];
    await conn.linkCalendarFromOAuth({ userId: user.id, provider: "google", providerAccountId: "sub-s2", accountEmail: "other@gmail.com", oauthAccountId: await oauthAccount(user.id, "sub-s2", "other@gmail.com"), tokens: tokens() });
    const second = (await connections(user.id)).find((r) => r.accountEmail === "other@gmail.com")!;
    expect((await calendarsOf(second.id)).map((c) => c.externalId)).toEqual(["other@gmail.com"]);
  });
});

describe("disconnect (CAL-16)", () => {
  it("clears credentials, cache and destination, audits, and revokes the token in a job", async () => {
    const g = await setupGoogle(t.db, { encrypted: { accessToken: "access-x", refreshToken: "refresh-x", expiresAt: new Date(Date.now() + 3_600_000) } });
    await t.db.update(users).set({ destinationCalendarId: g.calendarIds[0] }).where(eq(users.id, g.user.id));
    const [cal] = await t.db.select().from(calendars).where(eq(calendars.id, g.calendarIds[0]!));
    await addExternalBusy(t.db, { calendar: cal!, events: [{ start: new Date(), end: new Date(Date.now() + 3_600_000) }] });
    const res = await conn.disconnectConnection({ user: g.user }, g.connectionId);
    expect(res.destinationCleared).toBe(true);
    const [row] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.id, g.connectionId));
    expect(row).toMatchObject({ status: "disconnected", accessTokenEnc: null, refreshTokenEnc: null });
    expect(await calendarsOf(g.connectionId)).toEqual([]);
    expect(await t.db.select().from(externalEvents).where(eq(externalEvents.userId, g.user.id))).toEqual([]);
    expect(await destinationOf(g.user.id)).toBeNull();
    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "calendar.disconnected"), eq(auditLog.targetId, g.connectionId)));
    expect(audits).toHaveLength(1);
    const [job] = await t.db.select().from(jobs).where(eq(jobs.id, res.revokeJobId!));
    expect(job?.type).toBe("calendars.revoke_token");
    expect(JSON.stringify(job?.payload)).not.toContain("refresh-x");
    await handlers["calendars.revoke_token"]!(job!.payload, { db: t.db, jobId: job!.id, attempt: 1, now: new Date(), log });
    const revoke = f.callsTo("oauth2.googleapis.com/revoke");
    expect(revoke).toHaveLength(1);
    expect(revoke[0]!.raw).toContain("refresh-x");
    await expect(conn.disconnectConnection({ user: g.user }, g.connectionId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses to disconnect another user's connection", async () => {
    const a = await setupGoogle(t.db);
    const b = await setupGoogle(t.db);
    await expect(conn.disconnectConnection({ user: a.user }, b.connectionId)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("settings writes check ownership (GEN-08)", () => {
  it("answers 403 for another user's calendar as destination or conflict calendar, and for read-only destinations", async () => {
    const a = await setupGoogle(t.db, { calendars: [{ externalId: "a@x.com", isPrimary: true, canWrite: true }, { externalId: "ro@x.com", isPrimary: false, canWrite: false }] });
    const b = await setupGoogle(t.db);
    await expect(conn.setDestinationCalendar({ user: a.user }, b.calendarIds[0]!)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(conn.setDestinationCalendar({ user: a.user }, a.calendarIds[1]!)).rejects.toMatchObject({ code: "forbidden", message: "Choose a calendar you can add events to." });
    await expect(conn.setConflictCalendars({ user: a.user }, [{ calendarId: b.calendarIds[0]!, checked: false }])).rejects.toMatchObject({ code: "forbidden" });
    await expect(conn.setCalendarSyncSettings({ user: a.user }, { calendarId: b.calendarIds[0]!, includeBuffers: true })).rejects.toMatchObject({ code: "forbidden" });
    await conn.setDestinationCalendar({ user: a.user }, a.calendarIds[0]!);
    expect(await destinationOf(a.user.id)).toBe(a.calendarIds[0]);
    await conn.setCalendarSyncSettings({ user: a.user }, { calendarId: a.calendarIds[0]!, includeBuffers: true, syncChanges: false });
    const [cal] = await t.db.select().from(calendars).where(eq(calendars.id, a.calendarIds[0]!));
    expect(cal).toMatchObject({ includeBuffers: true, syncChanges: false });
    await conn.setDestinationCalendar({ user: a.user }, null);
    expect(await destinationOf(a.user.id)).toBeNull();
  });

  it("getDestinationCalendar skips calendars that need a reconnect", async () => {
    const g = await setupGoogle(t.db);
    await t.db.update(users).set({ destinationCalendarId: g.calendarIds[0] }).where(eq(users.id, g.user.id));
    expect(await conn.getDestinationCalendar(g.user.id)).toMatchObject({ calendarId: g.calendarIds[0], provider: "google", supports: { invitations: true, googleMeet: true, teams: false } });
    await t.db.update(calendarConnections).set({ status: "needs_reauth" }).where(eq(calendarConnections.id, g.connectionId));
    expect(await conn.getDestinationCalendar(g.user.id)).toBeNull();
  });
});
