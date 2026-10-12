// Token refresh and connection health on PGlite (SPEC CAL-02, CAL-15; ARCHITECTURE 10.1): Google keeps the stored
// refresh token when it returns none, a returned one is stored, a 401 refreshes once and retries, invalid_grant marks
// the connection needs_reauth (banner through getCalendarHealth, calendar.connection_broken, one email per user per 24
// hours, preference aware), a server without the Google OAuth client is a transient failure.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { calendarConnections, domainEvents, emailOutbox, jobs, users } = await import("@/db/schema");
const { decrypt } = await import("@/lib/crypto");
const { getConnectionContext, withConnection } = await import("@/lib/calendars/credentials");
const { getCalendarHealth, sendConnectionProblemEmail, PROBLEM_EMAIL_INTERVAL_MS } = await import("@/lib/calendars/health");
const { ProviderAuthError, ProviderTransientError } = await import("@/lib/calendars/providers/types");
const { freezeTime, mockFetch, mockResponse } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { setupGoogle, MIN, HOUR } = await import("./helpers");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  env.GOOGLE_CLIENT_ID = "google-client";
  env.GOOGLE_CLIENT_SECRET = "google-secret";
});
afterEach(() => {
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
});

async function conn(id: string) {
  const [row] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.id, id));
  return row!;
}

describe("token refresh", () => {
  it("refreshes an expiring token and keeps the stored refresh token when Google returns none", async () => {
    const g = await setupGoogle(t.db, { encrypted: { accessToken: "old-access", refreshToken: "refresh-1", expiresAt: new Date(Date.now() + 60_000) } });
    const f = mockFetch({
      method: "POST",
      url: "https://oauth2.googleapis.com/token",
      handler: (req) => {
        expect((req.body as Record<string, string>).refresh_token).toBe("refresh-1");
        return { access_token: "new-access", token_type: "Bearer", expires_in: 3599, scope: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly" };
      },
    });
    try {
      const ctx = await getConnectionContext(g.connectionId);
      expect(ctx.accessToken).toBe("new-access");
      const row = await conn(g.connectionId);
      expect(await decrypt(row.refreshTokenEnc!)).toBe("refresh-1");
      expect(await decrypt(row.accessTokenEnc!)).toBe("new-access");
      expect(row.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 50 * MIN);
      // Fresh now: no second refresh.
      await getConnectionContext(g.connectionId);
      expect(f.callsTo("oauth2.googleapis.com/token")).toHaveLength(1);
    } finally {
      f.restore();
    }
  });

  it("stores a rotated refresh token", async () => {
    const g = await setupGoogle(t.db, { encrypted: { accessToken: "a", refreshToken: "refresh-old", expiresAt: new Date(Date.now() - 1000) } });
    const f = mockFetch({ method: "POST", url: "https://oauth2.googleapis.com/token", handler: () => ({ access_token: "a2", refresh_token: "refresh-new", token_type: "Bearer", expires_in: 3599 }) });
    try {
      await getConnectionContext(g.connectionId);
      expect(await decrypt((await conn(g.connectionId)).refreshTokenEnc!)).toBe("refresh-new");
    } finally {
      f.restore();
    }
  });

  it("refreshes once on a 401 and retries the call", async () => {
    const g = await setupGoogle(t.db, { encrypted: { accessToken: "revoked-access", refreshToken: "refresh-1", expiresAt: new Date(Date.now() + HOUR) } });
    const f = mockFetch({ method: "POST", url: "https://oauth2.googleapis.com/token", handler: () => ({ access_token: "fresh-access", token_type: "Bearer", expires_in: 3599 }) });
    const seen: string[] = [];
    try {
      const result = await withConnection(g.connectionId, async (ctx) => {
        seen.push(ctx.accessToken!);
        if (ctx.accessToken === "revoked-access") throw new ProviderAuthError("401", "unauthorized");
        return "ok";
      });
      expect(result).toBe("ok");
      expect(seen).toEqual(["revoked-access", "fresh-access"]);
      expect(f.callsTo("oauth2.googleapis.com/token")).toHaveLength(1);
      expect((await conn(g.connectionId)).status).toBe("active");
    } finally {
      f.restore();
    }
  });

  it("is a transient failure when the server has no Google OAuth client", async () => {
    delete env.GOOGLE_CLIENT_ID;
    const g = await setupGoogle(t.db, { encrypted: { accessToken: "a", refreshToken: "r", expiresAt: new Date(Date.now() - 1000) } });
    await expect(getConnectionContext(g.connectionId)).rejects.toBeInstanceOf(ProviderTransientError);
    expect((await conn(g.connectionId)).status).toBe("active");
  });
});

describe("invalid_grant and connection health (CAL-15)", () => {
  it("marks needs_reauth, shows the banner and sends one email per 24 hours", async () => {
    const g = await setupGoogle(t.db, { encrypted: { accessToken: "a", refreshToken: "revoked", expiresAt: new Date(Date.now() - 1000) } });
    const f = mockFetch({
      method: "POST",
      url: "https://oauth2.googleapis.com/token",
      handler: () => mockResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 }),
    });
    try {
      await expect(getConnectionContext(g.connectionId)).rejects.toMatchObject({ name: "ProviderAuthError", reason: "invalid_grant" });
    } finally {
      f.restore();
    }
    const row = await conn(g.connectionId);
    expect(row).toMatchObject({ status: "needs_reauth", lastError: "invalid_grant" });
    expect(await getCalendarHealth(g.user.id)).toEqual({ ok: false, brokenConnections: [{ id: g.connectionId, email: row.accountEmail, status: "needs_reauth" }] });
    const events = await t.db.select().from(domainEvents).where(eq(domainEvents.type, "calendar.connection_broken"));
    expect(events.some((e) => (e.payload as { connectionId: string }).connectionId === g.connectionId)).toBe(true);
    const [job] = await t.db.select().from(jobs).where(and(eq(jobs.type, "calendars.connection_problem")));
    expect(job?.payload).toMatchObject({ userId: g.user.id });

    // Further calls fail fast without the network.
    await expect(getConnectionContext(g.connectionId)).rejects.toBeInstanceOf(ProviderAuthError);

    expect(await sendConnectionProblemEmail({ userId: g.user.id })).toBe("sent");
    expect(await sendConnectionProblemEmail({ userId: g.user.id })).toBe("skipped");
    const mails = await t.db.select().from(emailOutbox).where(eq(emailOutbox.relatedUserId, g.user.id));
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ subject: "There is a problem with your calendar connection", template: "calendar_connection_problem", toAddresses: [g.user.email] });
    expect(mails[0]!.text).toContain("Reconnect");
    expect(mails[0]!.text).toContain("/app/availability/calendar-settings");

    const clock = freezeTime(Date.now() + PROBLEM_EMAIL_INTERVAL_MS + MIN);
    try {
      expect(await sendConnectionProblemEmail({ userId: g.user.id })).toBe("sent");
    } finally {
      clock.restore();
    }
  });

  it("respects the Calendar connection problems preference and skips healed connections", async () => {
    const g = await setupGoogle(t.db, { status: "error" });
    await t.db
      .update(users)
      .set({ notificationPrefs: { pollVotes: "instant", calendarProblems: false, dailyAgenda: false, hostAdded: true, noReplyInviteeEmails: false } })
      .where(eq(users.id, g.user.id));
    expect(await sendConnectionProblemEmail({ userId: g.user.id })).toBe("skipped");
    const healthy = await setupGoogle(t.db);
    expect(await sendConnectionProblemEmail({ userId: healthy.user.id })).toBe("skipped");
    expect(await getCalendarHealth(healthy.user.id)).toEqual({ ok: true, brokenConnections: [] });
  });
});
