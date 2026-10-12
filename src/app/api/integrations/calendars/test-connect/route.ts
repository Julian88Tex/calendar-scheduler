// OWNER: calendar-integrations.
//
// POST /api/integrations/calendars/test-connect (E2E only, ARCHITECTURE section 24.2): stands in for Google's consent
// screen. It runs the real connect service (connectGoogleAccount: connection, calendar list, defaults, destination,
// audit) with the calendar list given in the body instead of a calendarList call, then optionally marks the connection
// broken. Answers 404 unless E2E_TEST_MODE=1, outside Vercel, with the per-run x-e2e-secret header (same guard as
// /api/test/*).
//   { email | userId, accountEmail, providerAccountId?, calendars?: [{ id, name, primary?, writable?, color? }],
//     status?: "active" | "needs_reauth" | "error" }
import { and, eq, isNull } from "drizzle-orm";
import { readJson, testJson, withTestGuard } from "@/app/api/test/_lib/guard";
import { getDb } from "@/db";
import { calendarConnections, users } from "@/db/schema";
import { connectGoogleAccount, GOOGLE_CALENDAR_SCOPES } from "@/lib/calendars/connections";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

type Body = {
  email?: string;
  userId?: string;
  accountEmail?: string;
  providerAccountId?: string;
  calendars?: { id: string; name?: string; primary?: boolean; writable?: boolean; color?: string | null }[];
  status?: "active" | "needs_reauth" | "error";
};

export const POST = withTestGuard(async (request) => {
  const body = await readJson<Body>(request);
  const db = await getDb();
  const where = body.userId
    ? eq(users.id, body.userId)
    : body.email
      ? and(eq(users.emailNormalized, body.email.trim().toLowerCase()), isNull(users.deletedAt))
      : null;
  if (!where) return testJson({ error: "validation", message: "email or userId required" }, { status: 400 });
  const [user] = await db.select({ id: users.id }).from(users).where(where).limit(1);
  if (!user) return testJson({ error: "not_found", message: "User not found" }, { status: 404 });
  const accountEmail = body.accountEmail?.trim() || "e2e.calendar@gmail.com";
  const calendars = body.calendars?.length ? body.calendars : [{ id: accountEmail, name: accountEmail, primary: true, writable: true }];
  const result = await connectGoogleAccount({
    userId: user.id,
    providerAccountId: body.providerAccountId ?? `e2e-${accountEmail}`,
    accountEmail,
    displayName: accountEmail,
    tokens: {
      accessToken: "e2e-access-token",
      refreshToken: "e2e-refresh-token",
      expiresAt: new Date(nowMs() + 365 * 86_400_000),
      scopes: ["openid", "email", "profile", ...GOOGLE_CALENDAR_SCOPES],
    },
    via: "connect",
    remoteCalendars: calendars.map((c) => ({
      externalId: c.id,
      name: c.name ?? c.id,
      color: c.color ?? null,
      isPrimary: c.primary === true,
      canWrite: c.writable !== false,
    })),
  });
  if (body.status && body.status !== "active") {
    await db
      .update(calendarConnections)
      .set({ status: body.status, lastError: body.status === "needs_reauth" ? "invalid_grant" : "fetch failed" })
      .where(eq(calendarConnections.id, result.connectionId));
  }
  return testJson({ ok: true, ...result });
});
