// gmail.send is requested together with the calendar scopes whenever Google is connected (sign in and connect, with
// incremental authorization: include_granted_scopes), never for the poll voter free/busy check; and a token refresh
// whose response omits `scope` never claims gmail.send for an account that did not grant it (the stored scopes stay).
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { calendarConnections } = await import("@/db/schema");
const { GOOGLE_AUTHORIZE_PARAMS, GOOGLE_SCOPES, googleAuthorizationUrl, googleScopesFor } = await import("@/lib/auth/oauth/google");
const { refreshAccessToken } = await import("@/lib/calendars/credentials");
const { GMAIL_SEND_SCOPE, hasGmailSendScope } = await import("@/lib/integrations/google/scopes");
const { mockFetch } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { createUser } = await import("../factories");
const h = await import("./helpers");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  env.GOOGLE_CLIENT_ID = "google-client";
  env.GOOGLE_CLIENT_SECRET = "google-secret";
});
afterEach(() => {
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
  vi.unstubAllGlobals();
});

describe("Google scopes", () => {
  it("asks for gmail.send with the calendar scopes on sign in and connect, not for the voter free/busy check", () => {
    expect(GMAIL_SEND_SCOPE).toBe("https://www.googleapis.com/auth/gmail.send");
    expect(GOOGLE_SCOPES).toEqual([
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
      GMAIL_SEND_SCOPE,
    ]);
    expect(googleScopesFor("connect_calendar")).toContain(GMAIL_SEND_SCOPE);
    expect(googleScopesFor("login")).toContain(GMAIL_SEND_SCOPE);
    expect(googleScopesFor("poll_freebusy")).not.toContain(GMAIL_SEND_SCOPE);
    expect(GOOGLE_AUTHORIZE_PARAMS).toMatchObject({ include_granted_scopes: "true", access_type: "offline", prompt: "consent" });
  });

  it("builds the consent URL with every scope and incremental authorization", () => {
    const url = googleAuthorizationUrl({ state: "state-1", codeVerifier: "v".repeat(43), intent: "connect_calendar" });
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...GOOGLE_SCOPES]);
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("detects gmail.send in a grant", () => {
    expect(hasGmailSendScope(h.GMAIL_SCOPES)).toBe(true);
    expect(hasGmailSendScope(h.CALENDAR_SCOPES)).toBe(false);
    expect(hasGmailSendScope(null)).toBe(false);
  });
});

describe("token refresh and stored scopes", () => {
  const refreshWith = async (scopes: string[], response: Record<string, unknown>) => {
    const user = await createUser(t.db);
    const conn = await h.connectGoogle(t.db, user, { scopes, expiresAt: new Date(Date.now() - 60_000) });
    const f = mockFetch({
      method: "POST",
      url: h.TOKEN_URL,
      handler: () => ({ access_token: "fresh", token_type: "Bearer", expires_in: 3599, ...response }),
    });
    try {
      await refreshAccessToken(conn.id);
    } finally {
      f.restore();
    }
    const [row] = await t.db.select({ scopes: calendarConnections.scopes }).from(calendarConnections).where(eq(calendarConnections.id, conn.id));
    return row!.scopes;
  };

  it("keeps the stored scopes when Google's response omits them (never claims gmail.send)", async () => {
    expect(await refreshWith(h.CALENDAR_SCOPES, {})).toEqual(h.CALENDAR_SCOPES);
    expect(await refreshWith(h.GMAIL_SCOPES, {})).toEqual(h.GMAIL_SCOPES);
  });

  it("stores the scopes Google reports", async () => {
    expect(await refreshWith(h.CALENDAR_SCOPES, { scope: h.GMAIL_SCOPES.join(" ") })).toEqual(h.GMAIL_SCOPES);
  });
});
