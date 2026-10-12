// POST /api/test/fake-calendar (E2E only): injects external busy events for a user.
//   { email | userId, events: [{ start, end, title?, allDay?, busy? }], replace?: boolean (default true) }
//
// The events live on a dedicated read-only connection that uses the `calendly_import` provider (CAL-22 semantics:
// its external_events rows are written by an importer and never refetched, its windows are always fresh), with one
// conflict-checked calendar "E2E fake calendar". The real busy cache (calendar-integrations getExternalBusy) therefore
// returns these events without any provider or network call. DELETE with { email | userId } removes the connection.
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarConnections, calendars, calendarSyncWindows, externalEvents, users } from "@/db/schema";
import { now } from "@/lib/time/now";
import { readJson, testJson, withTestGuard } from "../_lib/guard";

export const dynamic = "force-dynamic";

const ACCOUNT_ID = "e2e-fake-calendar";
const CALENDAR_EXTERNAL_ID = "e2e-fake";

type Body = {
  email?: string;
  userId?: string;
  replace?: boolean;
  events?: { start: string; end: string; title?: string | null; allDay?: boolean; busy?: boolean }[];
};

async function findUser(body: Body) {
  const db = await getDb();
  const where = body.userId
    ? eq(users.id, body.userId)
    : body.email
      ? and(eq(users.emailNormalized, body.email.trim().toLowerCase()), isNull(users.deletedAt))
      : null;
  if (!where) return null;
  const [user] = await db.select({ id: users.id }).from(users).where(where).limit(1);
  return user ?? null;
}

export const POST = withTestGuard(async (request) => {
  const body = await readJson<Body>(request);
  const user = await findUser(body);
  if (!user) return testJson({ error: "not_found", message: "User not found" }, { status: 404 });
  const db = await getDb();
  const t = now();
  const result = await db.transaction(async (tx) => {
    let [connection] = await tx
      .select()
      .from(calendarConnections)
      .where(
        and(
          eq(calendarConnections.userId, user.id),
          eq(calendarConnections.provider, "calendly_import"),
          eq(calendarConnections.providerAccountId, ACCOUNT_ID),
        ),
      )
      .limit(1);
    connection ??= (
      await tx
        .insert(calendarConnections)
        .values({
          userId: user.id,
          provider: "calendly_import",
          providerAccountId: ACCOUNT_ID,
          displayName: "E2E fake calendar",
          status: "active",
          lastSyncedAt: t,
        })
        .returning()
    )[0];
    let [calendar] = await tx
      .select()
      .from(calendars)
      .where(and(eq(calendars.connectionId, connection.id), eq(calendars.externalId, CALENDAR_EXTERNAL_ID)))
      .limit(1);
    calendar ??= (
      await tx
        .insert(calendars)
        .values({
          connectionId: connection.id,
          userId: user.id,
          externalId: CALENDAR_EXTERNAL_ID,
          name: "E2E fake calendar",
          isPrimary: false,
          canWrite: false,
          checkConflicts: true,
          syncChanges: false,
        })
        .returning()
    )[0];
    if (body.replace !== false) await tx.delete(externalEvents).where(eq(externalEvents.calendarId, calendar.id));
    const events = body.events ?? [];
    if (events.length) {
      await tx.insert(externalEvents).values(
        events.map((e, i) => {
          const start = new Date(e.start);
          const end = new Date(e.end);
          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
            throw new Error(`Invalid event ${i}: start and end must be ISO instants with end after start`);
          }
          return {
            calendarId: calendar.id,
            userId: user.id,
            externalId: `e2e-${t.getTime()}-${i}`,
            startAt: start,
            endAt: end,
            allDay: e.allDay ?? false,
            allDayStartDate: e.allDay ? e.start.slice(0, 10) : null,
            allDayEndDate: e.allDay ? e.end.slice(0, 10) : null,
            title: e.title ?? "Busy",
            busy: e.busy ?? true,
            fetchedAt: t,
          };
        }),
      );
    }
    // One wide, fresh window so the busy cache never considers these rows stale.
    await tx.delete(calendarSyncWindows).where(eq(calendarSyncWindows.calendarId, calendar.id));
    await tx.insert(calendarSyncWindows).values({
      calendarId: calendar.id,
      windowStart: new Date(t.getTime() - 365 * 86_400_000),
      windowEnd: new Date(t.getTime() + 3 * 365 * 86_400_000),
      fetchedAt: t,
      status: "ok",
    });
    return { connectionId: connection.id, calendarId: calendar.id, events: events.length };
  });
  return testJson({ ok: true, ...result });
});

export const DELETE = withTestGuard(async (request) => {
  const body = await readJson<Body>(request);
  const user = await findUser(body);
  if (!user) return testJson({ error: "not_found", message: "User not found" }, { status: 404 });
  const db = await getDb();
  await db
    .delete(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, user.id),
        eq(calendarConnections.provider, "calendly_import"),
        eq(calendarConnections.providerAccountId, ACCOUNT_ID),
      ),
    );
  return testJson({ ok: true });
});
