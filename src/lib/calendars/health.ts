// OWNER: calendar-integrations.
//
// Connection health (SPEC CAL-15, SCH-11): statuses active, needs_reauth (token revoked, invalid_grant, missing
// scopes), error (repeated fetch failures or a disabled API) and disconnected.
// - markConnectionBroken: moves a connection to needs_reauth or error, publishes calendar.connection_broken on the
//   transition and enqueues the "There is a problem with your calendar connection" email job, which sends at most one
//   email per user per 24 hours (and only when Settings > Notifications > "Calendar connection problems" is on).
// - recordConnectionFailure: counts transient failures; the third in a row marks the connection error.
// - markConnectionHealthy: a successful provider call resets the counter and heals an error connection (never a
//   needs_reauth one: only a reconnect fixes credentials).
// - getCalendarHealth: what the dashboard banner shows.
import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { calendarConnections, organizationMemberships, users } from "@/db/schema";
import { DEFAULT_NOTIFICATION_PREFS } from "@/db/types";
import { emailBrandForUser, sendEmail } from "@/lib/email";
import { publishEvent } from "@/lib/events";
import { enqueueJob } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { connectionProblemEmail } from "./emails";

/** Transient failures in a row before a connection shows "Error". */
export const FAILURES_BEFORE_ERROR = 3;
/** At most one connection problem email per user in this window (CAL-15). */
export const PROBLEM_EMAIL_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CONNECTION_PROBLEM_JOB = "calendars.connection_problem";

export type BrokenStatus = "needs_reauth" | "error";

const truncate = (s: string, n = 500) => (s.length > n ? s.slice(0, n) : s);

async function orgOf(db: DbOrTx, userId: string): Promise<string | null> {
  const [m] = await db
    .select({ orgId: organizationMemberships.organizationId })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, userId))
    .limit(1);
  return m?.orgId ?? null;
}

/** Marks a connection broken (no-op for disconnected connections). Returns true when the status changed. */
export async function markConnectionBroken(connectionId: string, p: { status: BrokenStatus; error: string }, dbOrTx?: DbOrTx): Promise<boolean> {
  const db = dbOrTx ?? (await getDb());
  const t = now();
  const changed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: calendarConnections.id, userId: calendarConnections.userId, status: calendarConnections.status })
      .from(calendarConnections)
      .where(eq(calendarConnections.id, connectionId))
      .for("update")
      .limit(1);
    if (!row || row.status === "disconnected") return false;
    // needs_reauth wins over error: a reconnect is the only fix, so a later fetch failure must not hide it.
    const next: BrokenStatus = row.status === "needs_reauth" ? "needs_reauth" : p.status;
    await tx
      .update(calendarConnections)
      .set({ status: next, lastError: truncate(p.error), lastErrorAt: t, updatedAt: t })
      .where(eq(calendarConnections.id, connectionId));
    if (row.status === next) return false;
    await publishEvent(tx, "calendar.connection_broken", { connectionId, userId: row.userId }, { organizationId: await orgOf(tx, row.userId), actor: { type: "system" } });
    await enqueueJob(tx, {
      type: CONNECTION_PROBLEM_JOB,
      payload: { userId: row.userId, connectionId },
      idempotencyKey: `calendar_problem:${row.userId}:${Math.floor(t.getTime() / PROBLEM_EMAIL_INTERVAL_MS)}`,
      maxAttempts: 5,
    });
    return true;
  });
  if (changed) log.warn("calendars.connection_broken", { connectionId, status: p.status, error: p.error });
  return changed;
}

/** Counts a transient provider failure; the FAILURES_BEFORE_ERROR-th in a row marks the connection error. */
export async function recordConnectionFailure(connectionId: string, error: string): Promise<void> {
  const db = await getDb();
  const t = now();
  const [row] = await db
    .update(calendarConnections)
    .set({ consecutiveFailures: sql`${calendarConnections.consecutiveFailures} + 1`, lastError: truncate(error), lastErrorAt: t })
    .where(and(eq(calendarConnections.id, connectionId), ne(calendarConnections.status, "disconnected")))
    .returning({ failures: calendarConnections.consecutiveFailures, status: calendarConnections.status });
  if (row && row.status === "active" && row.failures >= FAILURES_BEFORE_ERROR) {
    await markConnectionBroken(connectionId, { status: "error", error }, db);
  }
}

/** A provider call succeeded: reset the failure counter and heal an "error" connection. */
export async function markConnectionHealthy(connectionId: string, dbOrTx?: DbOrTx): Promise<void> {
  const db = dbOrTx ?? (await getDb());
  const t = now();
  await db
    .update(calendarConnections)
    .set({
      consecutiveFailures: 0,
      lastSyncedAt: t,
      status: sql`case when ${calendarConnections.status} = 'error' then 'active'::connection_status else ${calendarConnections.status} end`,
      lastError: sql`case when ${calendarConnections.status} = 'needs_reauth' then ${calendarConnections.lastError} else null end`,
    })
    .where(and(eq(calendarConnections.id, connectionId), ne(calendarConnections.status, "disconnected")));
}

/** CAL-15 banner data: the user's connections that need attention. */
export async function getCalendarHealth(
  userId: string,
): Promise<{ ok: boolean; brokenConnections: { id: string; email: string | null; status: string }[] }> {
  const db = await getDb();
  const rows = await db
    .select({
      id: calendarConnections.id,
      email: calendarConnections.accountEmail,
      displayName: calendarConnections.displayName,
      status: calendarConnections.status,
    })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.userId, userId), inArray(calendarConnections.status, ["needs_reauth", "error"])))
    .orderBy(calendarConnections.createdAt);
  const brokenConnections = rows.map((r) => ({ id: r.id, email: r.email ?? r.displayName ?? null, status: r.status }));
  return { ok: brokenConnections.length === 0, brokenConnections };
}

/** Job handler: the connection problem email (at most one per user per 24 hours, preference aware). */
export async function sendConnectionProblemEmail(p: { userId: string }): Promise<"sent" | "skipped"> {
  const db = await getDb();
  const t = now();
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, prefs: users.notificationPrefs, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, p.userId))
    .limit(1);
  if (!user || user.deletedAt) return "skipped";
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(user.prefs ?? {}) };
  const connections = await db
    .select({
      id: calendarConnections.id,
      provider: calendarConnections.provider,
      email: calendarConnections.accountEmail,
      status: calendarConnections.status,
      notifiedAt: calendarConnections.problemNotifiedAt,
    })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.userId, user.id), ne(calendarConnections.status, "disconnected")));
  const broken = connections.filter((c) => c.status === "needs_reauth" || c.status === "error");
  if (!broken.length) return "skipped"; // fixed before the job ran
  const lastNotified = Math.max(0, ...connections.map((c) => c.notifiedAt?.getTime() ?? 0));
  if (t.getTime() - lastNotified < PROBLEM_EMAIL_INTERVAL_MS) return "skipped";
  if (prefs.calendarProblems === false) return "skipped";

  const brand = await emailBrandForUser(user.id, db);
  const rendered = connectionProblemEmail({ name: user.name, accounts: broken.map((c) => ({ email: c.email, provider: c.provider })), brand });
  await sendEmail({
    to: [user.email],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    template: "calendar_connection_problem",
    category: "system",
    idempotencyKey: `calendar_problem:${user.id}:${Math.floor(t.getTime() / PROBLEM_EMAIL_INTERVAL_MS)}`,
    related: { userId: user.id },
  });
  await db
    .update(calendarConnections)
    .set({ problemNotifiedAt: t })
    .where(inArray(calendarConnections.id, broken.map((c) => c.id)));
  return "sent";
}
