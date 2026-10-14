// Sessions core (ARCHITECTURE 18.3, SPEC AU-05, AU-06).
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();
const setCalls: { name: string; value: string; opts: Record<string, unknown> }[] = [];
let requestHeaders = new Headers();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined),
    has: (name: string) => cookieStore.has(name),
    set: (name: string, value: string, opts: Record<string, unknown>) => {
      setCalls.push({ name, value, opts });
      if (opts?.maxAge === 0) cookieStore.delete(name);
      else cookieStore.set(name, value);
    },
  }),
  headers: async () => requestHeaders,
}));

const { sessions, users } = await import("@/db/schema");
const session = await import("@/lib/auth/session");
const { hashToken } = await import("@/lib/crypto");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const { createUser } = await import("../factories");

const t = useTestDb();

beforeEach(() => {
  cookieStore.clear();
  setCalls.length = 0;
  requestHeaders = new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
});
afterEach(() => resetFakeTime());

function redirectTarget(e: unknown): string | null {
  const digest = (e as { digest?: string })?.digest;
  if (!digest?.startsWith("NEXT_REDIRECT")) return null;
  return digest.split(";")[2] ?? null;
}

describe("session records", () => {
  it("stores only the SHA-256 of the 32-byte token and looks it up", async () => {
    const u = await createUser(t.db);
    const { token, session: row } = await session.createSessionRecord(t.db, u.id, { ip: "1.2.3.4", userAgent: "UA" });
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toContain(token);
    const found = await session.lookupSession(t.db, token);
    expect(found?.user.id).toBe(u.id);
    expect(found?.session.id).toBe(row.id);
    expect(await session.lookupSession(t.db, "wrong")).toBeNull();
    expect(await session.lookupSession(t.db, "")).toBeNull();
    expect(await session.lookupSession(t.db, null)).toBeNull();
  });

  it("rejects revoked sessions, sessions of deleted users, and sessions last seen 31 days ago (AU-06)", async () => {
    const u = await createUser(t.db);
    setFakeNow("2030-01-01T00:00:00Z");
    const a = await session.createSessionRecord(t.db, u.id);
    const b = await session.createSessionRecord(t.db, u.id);
    await t.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, b.session.id));
    expect(await session.lookupSession(t.db, b.token)).toBeNull();
    setFakeNow("2030-01-31T01:00:00Z"); // 30 days and 1 hour later, never touched
    expect(await session.lookupSession(t.db, a.token)).toBeNull();

    const v = await createUser(t.db);
    const c = await session.createSessionRecord(t.db, v.id);
    await t.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, v.id));
    expect(await session.lookupSession(t.db, c.token)).toBeNull();
  });

  it("slides: a session used today after more than 24 hours gets 30 more days", async () => {
    const u = await createUser(t.db);
    setFakeNow("2030-02-01T00:00:00Z");
    const { token, session: row } = await session.createSessionRecord(t.db, u.id);
    expect(session.sessionNeedsRefresh(row)).toBe(false);
    setFakeNow("2030-02-20T00:00:00Z");
    expect(session.sessionNeedsRefresh(row)).toBe(true);
    await session.touchSessionRecord(t.db, row.id, u.id);
    const [after] = await t.db.select().from(sessions).where(eq(sessions.id, row.id));
    // now() keeps flowing after setFakeNow(), so allow a little slack.
    const near = (d: Date | null | undefined, iso: string) => expect(Math.abs(d!.getTime() - Date.parse(iso))).toBeLessThan(5000);
    near(after!.expiresAt, "2030-03-22T00:00:00.000Z");
    near(after!.lastSeenAt, "2030-02-20T00:00:00.000Z");
    setFakeNow("2030-03-10T00:00:00Z"); // past the original 30 days, inside the extension
    expect(await session.lookupSession(t.db, token)).not.toBeNull();
    const [user] = await t.db.select({ lastActiveAt: users.lastActiveAt }).from(users).where(eq(users.id, u.id));
    near(user!.lastActiveAt, "2030-02-20T00:00:00.000Z");
  });
});

describe("cookie flows", () => {
  it("createSession sets an httpOnly SameSite=Lax sid cookie and records IP and user agent", async () => {
    const u = await createUser(t.db);
    const { sessionId } = await session.createSession(u.id);
    const call = setCalls.find((c) => c.name === session.SESSION_COOKIE)!;
    expect(call.opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(call.opts.secure).toBe(false); // http://localhost in tests
    const [row] = await t.db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row).toMatchObject({ ip: "203.0.113.5", userAgent: "vitest", twoFactorPending: false });
    expect(row!.tokenHash).toBe(hashToken(call.value));

    const current = await session.getSession();
    expect(current?.user.id).toBe(u.id);
    expect((await session.getCurrentUser())?.id).toBe(u.id);
    expect((await session.requireUser()).id).toBe(u.id);
  });

  it("requireUser redirects to /login?next= when signed out, or throws 401 for route handlers", async () => {
    requestHeaders.set(session.PATHNAME_HEADER, "/app/meetings?tab=past");
    const err = await session.requireUser().catch((e: unknown) => e);
    expect(redirectTarget(err)).toBe(`/login?next=${encodeURIComponent("/app/meetings?tab=past")}`);
    const fromOpt = await session.requireUser({ next: "/app/workflows" }).catch((e: unknown) => e);
    expect(redirectTarget(fromOpt)).toBe(`/login?next=${encodeURIComponent("/app/workflows")}`);
    const unsafe = await session.requireUser({ next: "//evil.example" }).catch((e: unknown) => e);
    expect(redirectTarget(unsafe)).toBe("/login");
    await expect(session.requireUser({ onMissing: "throw" })).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(await session.getSession()).toBeNull();
  });

  it("two_factor_pending sessions only reach /login/two-factor until completed", async () => {
    const u = await createUser(t.db);
    const { sessionId } = await session.createSession(u.id, { twoFactorPending: true });
    expect((await session.getSession())?.session.twoFactorPending).toBe(true);
    expect(await session.getCurrentUser()).toBeNull();
    expect(redirectTarget(await session.requireUser().catch((e: unknown) => e))).toBe("/login/two-factor");
    await expect(session.requireUser({ onMissing: "throw" })).rejects.toMatchObject({ code: "unauthorized" });
    await session.completeTwoFactor(sessionId);
    expect((await session.requireUser()).id).toBe(u.id);
  });

  it("logout revokes server side and clears the cookie; reusing the old value fails (AU-05)", async () => {
    const u = await createUser(t.db);
    await session.createSession(u.id);
    const token = cookieStore.get(session.SESSION_COOKIE)!;
    await session.destroySession();
    expect(setCalls.at(-1)).toMatchObject({ name: "sid", value: "", opts: expect.objectContaining({ maxAge: 0 }) });
    expect(await session.lookupSession(t.db, token)).toBeNull();
    cookieStore.set(session.SESSION_COOKIE, token); // replay the old cookie
    expect(await session.getSession()).toBeNull();
  });

  it("revokes other sessions or all sessions, and lists active ones", async () => {
    const u = await createUser(t.db);
    const a = await session.createSessionRecord(t.db, u.id);
    const b = await session.createSessionRecord(t.db, u.id);
    const c = await session.createSessionRecord(t.db, u.id);
    await session.revokeOtherSessions(u.id, a.session.id);
    expect(await session.lookupSession(t.db, a.token)).not.toBeNull();
    expect(await session.lookupSession(t.db, b.token)).toBeNull();
    expect(await session.lookupSession(t.db, c.token)).toBeNull();
    expect((await session.listSessions(u.id)).map((s) => s.id)).toEqual([a.session.id]);
    // With a userId, only that user's session is revoked (ids from user input).
    const stranger = await createUser(t.db);
    await session.revokeSession(a.session.id, { userId: stranger.id });
    expect(await session.lookupSession(t.db, a.token)).not.toBeNull();
    await session.revokeSession(a.session.id, { userId: u.id });
    expect(await session.listSessions(u.id)).toEqual([]);
    const e = await session.createSessionRecord(t.db, u.id);
    await session.revokeSession(e.session.id);
    expect(await session.lookupSession(t.db, e.token)).toBeNull();
    const d = await session.createSessionRecord(t.db, u.id);
    await session.revokeAllSessions(u.id);
    expect(await session.lookupSession(t.db, d.token)).toBeNull();
  });
});
