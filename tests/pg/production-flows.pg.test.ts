// Production flows on real Postgres through the production database client (npm run test:pg).
//
// Why: the regular suite runs on PGlite, which serializes parameters itself. Production runs postgres.js through
// drizzle, whose transparent serializers for timestamp, date, time, json and jsonb parameters hand the raw JS value
// to the wire protocol: a Date or an object interpolated into a raw sql`` template (or compared through an operator
// whose left side is sql``) fails there with "The string argument must be of type string or an instance of Buffer or
// ArrayBuffer". PGlite also parses int8 as a number where postgres.js returns a string, and it runs every statement
// on one session (a query outside an open transaction sees its rows), so whole classes of production failures are
// invisible to the PGlite suite. This file closes that gap:
//
// - the database is migrated and used by the PRODUCTION client: DATABASE_URL points at a fresh database on the
//   embedded server and getDb() builds the postgres.js pool exactly as on Vercel (prepare: false, max 5, migrations
//   through the guarded runtime path);
// - the owner is bootstrapped through src/lib/setup/bootstrap.ts (the go-live path: 3 event types, 2 schedules, the
//   24 hour reminders), Google is connected through the real connect service (token refresh included), and only the
//   network edges are fake: the calendar provider (tests/helpers/fake-providers.ts), the Google channel calls and
//   fetch for Gmail send, the OAuth token endpoints and nothing else (any other request fails the run);
// - real flows run end to end: the slots API, Troubleshoot, bookings through POST /api/public/bookings and the email
//   verification flow, invitee reschedule and cancel, host cancel, no-show, request reschedule, meeting notes, host
//   meeting limits, host-side Google moves and deletes, a push notification, reminders (with a backfill), meeting
//   polls (holds, invites, votes, comments, deadline, booking, rebooking), the meetings list, its CSV export, the
//   cron dispatcher (authorized and open mode), Gmail failures (retry and held emails) and system.cleanup;
// - every registered job handler and every event subscriber must have run successfully at least once (the coverage
//   checks at the end fail when a new handler is added without a flow here), and no job may end with an error.
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const env = process.env as Record<string, string | undefined>;
  // Production-like configuration: a public https origin (Google push channels on), Google OAuth configured (token
  // refresh and revoke paths), the cron secret (authorized /api/cron).
  env.APP_URL = "https://kairos.example.com";
  env.GOOGLE_CLIENT_ID = "pg-suite.apps.googleusercontent.com";
  env.GOOGLE_CLIENT_SECRET = "pg-suite-secret";
  env.CRON_SECRET = "pg-suite-cron-secret";
  return {
    cookies: new Map<string, string>(),
    /** channelId -> plaintext channel token (captured from the events.watch call). */
    channels: new Map<string, { token: string; calendarExternalId: string }>(),
    fetchLog: [] as string[],
    unexpectedFetch: [] as string[],
    /** Gmail send answers 500 this many more times. */
    gmailFailures: 0,
    gmailSent: 0,
    /** warn and error lines of the app logger (services that catch and log a failed query are checked too). */
    logged: [] as string[],
  };
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "kairos.example.com" }),
  cookies: async () => ({
    get: (name: string) => (h.cookies.has(name) ? { name, value: h.cookies.get(name)! } : undefined),
    getAll: () => [...h.cookies].map(([name, value]) => ({ name, value })),
    has: (name: string) => h.cookies.has(name),
    set: (name: string | { name: string; value: string }, value?: string) => {
      if (typeof name === "string") h.cookies.set(name, value ?? "");
      else h.cookies.set(name.name, name.value);
    },
    delete: (name: string) => {
      h.cookies.delete(name);
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/calendars/providers/registry", async () => {
  const { fakeCalendarProvider } = await import("../helpers/fake-providers");
  return {
    getProvider: (id: string) => (id === "google" ? fakeCalendarProvider("google") : null),
    isCacheOnlyProvider: (id: string) => id === "calendly_import",
  };
});
vi.mock("@/lib/calendars/providers/google", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars/providers/google")>();
  return {
    ...real,
    watchGoogleEvents: async (_ctx: unknown, calendarExternalId: string, p: { channelId: string; token: string; ttlSeconds: number }) => {
      h.channels.set(p.channelId, { token: p.token, calendarExternalId });
      const { now } = await import("@/lib/time/now");
      return { channelId: p.channelId, resourceId: `res-${p.channelId.slice(0, 8)}`, expiresAt: new Date(now().getTime() + p.ttlSeconds * 1000) };
    },
    stopGoogleChannel: async () => {},
  };
});

const env = process.env as Record<string, string | undefined>;
// Each step drives whole flows (and the job runner) over a real network connection.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 });

const schema = await import("@/db/schema");
const {
  calendarConnections,
  calendarLinkedEvents,
  calendars,
  calendarSyncWindows,
  calendarWatchChannels,
  domainEvents,
  emailOutbox,
  eventTypes,
  externalEvents,
  invitees,
  jobs,
  meetingPollOptions,
  meetingPollParticipants,
  meetingPolls,
  rateLimitBuckets,
  scheduledEvents,
  sessions,
  users,
  workflows,
} = schema;
const dbMod = await import("@/db");
const { closeDb, dbKind, getDb, setDbForTests } = dbMod;
type DB = import("@/db").DB;
const { loadMigrations, migrationsBehind } = await import("@/db/migrate");
const { createSessionRecord, getCurrentUser, SESSION_COOKIE } = await import("@/lib/auth/session");
const { loadActorCtx } = await import("@/lib/authz");
type ActorCtx = import("@/lib/authz").ActorCtx;
const { bootstrapOwner } = await import("@/lib/setup/bootstrap");
const { connectGoogleAccount, disconnectConnection, GOOGLE_CALENDAR_SCOPES, setCalendarSyncSettings, setConflictCalendars } = await import("@/lib/calendars/connections");
const { GMAIL_SEND_SCOPE } = await import("@/lib/integrations/google/scopes");
const { getCalendarSettingsView } = await import("@/lib/calendars/settings");
const { getDestinationCalendar } = await import("@/lib/calendars");
const { getExternalBusy } = await import("@/lib/calendars/busy");
const { issueBookingFormToken, loadEventType, troubleshootAvailability, publicSlots } = await import("@/lib/booking");
const { createReservation, verifyReservationCode } = await import("@/lib/booking/create");
const { getTroubleshootDay } = await import("@/lib/availability/troubleshoot");
const { loadSchedulesPage } = await import("@/lib/availability/page-data");
const { countHostMeetings, getMeetingLimits, setMeetingLimits } = await import("@/lib/availability/limits");
const lifecycle = await import("@/lib/lifecycle");
const { saveEventTypeReminders, getEventTypeReminders } = await import("@/lib/workflows/reminders");
const { loadMeetingsPage } = await import("@/lib/meetings/queries");
const { exportCsvLines } = await import("@/lib/meetings/export");
const { parseMeetingsQuery } = await import("@/lib/meetings/filters");
const { createPoll } = await import("@/lib/polls/create");
const { submitVote } = await import("@/lib/polls/vote");
const { invitePeople, sendReminders } = await import("@/lib/polls/invites");
const { addHostComment, addPublicComment } = await import("@/lib/polls/comments");
const { bookPoll } = await import("@/lib/polls/book");
const { closeVoting, deletePoll, reopenPoll } = await import("@/lib/polls/manage");
const { exportPollCsv, getHostPoll, getPollActivity, getVoterView, listPolls } = await import("@/lib/polls/queries");
const { POLL_JOBS } = await import("@/lib/polls/constants");
const { runDueJobs } = await import("@/lib/jobs");
const { getJobHandler, PERIODIC_JOBS, registeredJobTypes } = await import("@/lib/jobs/registry");
const { SUBSCRIBER_REGISTRY } = await import("@/lib/events/registry");
const { log } = await import("@/lib/logger");
const { encrypt } = await import("@/lib/crypto");
const { now, resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { fakeCalendarProvider, resetFakeProviders } = await import("../helpers/fake-providers");
const { createTestDb } = await import("../helpers/db");
const slotsRoute = await import("@/app/api/public/slots/route");
const bookingsRoute = await import("@/app/api/public/bookings/route");
const cronRoute = await import("@/app/api/cron/route");
const exportRoute = await import("@/app/api/meetings/export/route");
const googlePushRoute = await import("@/app/api/webhooks/calendars/google/route");
const healthRoute = await import("@/app/api/health/route");
const pollExportRoute = await import("@/app/api/polls/[id]/export.csv/route");
const holdsSyncRoute = await import("@/app/api/polls/[id]/holds/sync/route");
const publicPollRoute = await import("@/app/api/public/polls/[slug]/route");
const pollBusyRoute = await import("@/app/api/polls/busy/route");

// ---------------------------------------------------------------------------------------------------------------
// Time: Monday 2031-04-07 09:00 in Los Angeles (PDT, UTC-7 from March 9 to November 2, 2031).

const LA = "America/Los_Angeles";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = new Date("2031-04-07T16:00:00Z");
/** "2031-04-09 12:00" (Los Angeles wall time) to a Date. */
const la = (local: string): Date => new Date(`${local.replace(" ", "T")}:00-07:00`);
const advanceTo = (at: Date) => setFakeNow(at);
const advance = (ms: number) => setFakeNow(new Date(now().getTime() + ms));
const OWNER_EMAIL = "julian@kairos-owner.example.com";

// ---------------------------------------------------------------------------------------------------------------
// fetch: Gmail send, Google OAuth token refresh and revoke. Anything else is recorded as unexpected (fails the run).

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  h.fetchLog.push(`${method} ${url}`);
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")) {
    if (h.gmailFailures > 0) {
      h.gmailFailures--;
      return Response.json({ error: { code: 500, message: "backend error", status: "INTERNAL" } }, { status: 500 });
    }
    h.gmailSent++;
    return Response.json({ id: `gmail-${h.gmailSent}`, threadId: `thread-${h.gmailSent}`, labelIds: ["SENT"] });
  }
  if (url === "https://oauth2.googleapis.com/token") {
    return Response.json({
      access_token: `fresh-access-${h.fetchLog.length}`,
      expires_in: 3599,
      token_type: "Bearer",
      scope: [...GOOGLE_CALENDAR_SCOPES, GMAIL_SEND_SCOPE].join(" "),
    });
  }
  if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response(null, { status: 200 });
  h.unexpectedFetch.push(`${method} ${url}`);
  return new Response("unexpected request in the pg suite", { status: 599 });
}

// ---------------------------------------------------------------------------------------------------------------
// Jobs: drain through the real runner, then fail on any job that ended with an error.

/** Every job type (and event dispatcher job) that succeeded at least once, recorded before cleanup deletes rows. */
const succeededTypes = new Set<string>();
/** Job types run directly with realistic payloads (types no flow here enqueues). */
const directTypes = new Set<string>();

/** Errors a job may legitimately record on its way to success (none today; keep this list short and explained). */
const BENIGN_ERRORS: RegExp[] = [];

/** Driver and SQL failures: none may appear in any job error or logged line during the run. */
const DRIVER_ERROR =
  /Failed query|ERR_INVALID_ARG_TYPE|must be of type string or an instance of Buffer|PostgresError|syntax error at or near|could not determine data type|operator does not exist|invalid input syntax|deadlock detected|current transaction is aborted|bind message supplies/i;

async function recordSucceeded(db: DB): Promise<void> {
  const rows = await db.selectDistinct({ type: jobs.type }).from(jobs).where(eq(jobs.status, "succeeded"));
  for (const r of rows) succeededTypes.add(r.type);
}

async function unhealthyJobs(db: DB, opts: { allow?: RegExp[] } = {}) {
  const rows = await db
    .select({ id: jobs.id, type: jobs.type, status: jobs.status, lastError: jobs.lastError, attempts: jobs.attempts })
    .from(jobs)
    .where(or(eq(jobs.status, "dead"), and(isNotNull(jobs.lastError), ne(jobs.status, "succeeded"))));
  const allow = [...BENIGN_ERRORS, ...(opts.allow ?? [])];
  return rows.filter((r) => !(r.lastError && allow.some((re) => re.test(r.lastError!))));
}

/** Runs every due job (periodic ones included) until the queue is idle, then asserts that none failed. */
async function drain(db: DB, label: string, opts: { allow?: RegExp[]; rounds?: number } = {}): Promise<void> {
  for (let i = 0; i < (opts.rounds ?? 25); i++) {
    const r = await runDueJobs({ budgetMs: 60_000, workerId: "pg-suite", maxJobs: 500 });
    if (r.ran === 0) break;
  }
  await recordSucceeded(db);
  const bad = await unhealthyJobs(db, opts);
  expect(bad, `${label}: jobs failed on postgres.js`).toEqual([]);
}

async function runHandlerDirectly(db: DB, type: string, payload: Record<string, unknown>): Promise<unknown> {
  const handler = getJobHandler(type);
  expect(handler, `no handler registered for ${type}`).toBeTypeOf("function");
  const [row] = await db.insert(jobs).values({ type, payload, status: "running", runAt: now(), attempts: 1 }).returning({ id: jobs.id });
  const out = await handler!(payload, { db, jobId: row!.id, attempt: 1, now: now(), log: log.child({ jobType: type }), type });
  await db.update(jobs).set({ status: "succeeded", finishedAt: now(), result: (out as { result?: unknown } | undefined)?.result ?? null }).where(eq(jobs.id, row!.id));
  directTypes.add(type);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers

async function outbox(db: DB, where: { to?: string; template?: string } = {}) {
  const rows = await db.select().from(emailOutbox).orderBy(emailOutbox.createdAt);
  return rows.filter((r) => (!where.to || r.toAddresses.includes(where.to)) && (!where.template || r.template === where.template));
}

function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://kairos.example.com", "x-forwarded-for": "198.51.100.7", ...headers },
    body: JSON.stringify(body),
  });
}

let ipSeq = 0;
const freshIp = () => `198.51.100.${(ipSeq = (ipSeq % 200) + 1)}`;

async function signIn(db: DB, userId: string): Promise<void> {
  const { token } = await createSessionRecord(db, userId, { ip: "198.51.100.1", userAgent: "pg-suite" });
  h.cookies.set(SESSION_COOKIE, token);
}

async function readCsv(res: Response): Promise<string> {
  expect(res.status).toBe(200);
  return await res.text();
}

// ---------------------------------------------------------------------------------------------------------------

describe.runIf(process.env.TEST_DATABASE_URL)("production flows on real Postgres through the production client", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let db: DB;
  let ownerId: string;
  let actor: ActorCtx;
  let orgId: string;
  let connectionId: string;
  let primaryCalendarId: string;
  const et: Record<"30min" | "60min" | "meal", { id: string; questions: { id: string }[]; locations: { id: string; kind: string }[] }> = {} as never;
  const meetings: Record<string, { inviteeId: string; scheduledEventId: string; email: string }> = {};

  beforeAll(async () => {
    t = await createTestDb({ kind: "postgres", migrate: false, setGlobal: false });
    env.DATABASE_URL = t.url;
    setDbForTests(null);
    resetFakeProviders();
    vi.stubGlobal("fetch", fakeFetch);
    for (const level of ["warn", "error"] as const) {
      const original = console[level].bind(console);
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        h.logged.push(args.map((a) => (typeof a === "string" ? a : a instanceof Error ? `${a.name}: ${a.message}` : JSON.stringify(a))).join(" "));
        original(...args);
      });
    }
    setFakeNow(T0);
    db = await getDb();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    resetFakeTime();
    h.cookies.clear();
    await closeDb().catch(() => {});
    delete env.DATABASE_URL;
    await t?.close();
  });

  it("the production client is postgres.js and applied every migration through the runtime path", async () => {
    expect(dbKind()).toBe("postgres");
    const migrations = loadMigrations("drizzle");
    expect(await migrationsBehind(db, migrations)).toBe(false);
    const rows = await db.execute(sql`select count(*) as n from "drizzle"."__drizzle_migrations"`);
    const n = Number((rows as unknown as { n: string }[])[0]?.n);
    expect(n).toBe(migrations.length);
    const health = await healthRoute.GET();
    expect(health.status).toBe(200);
  });

  it("bootstraps the owner and connects Google through the real connect service (token refresh included)", async () => {
    const boot = await bootstrapOwner({ email: OWNER_EMAIL, name: "Julian Joseph" });
    expect(boot.snapshot.status).toBe("applied");
    ownerId = boot.user.id;
    const [ownerRow] = await db.select().from(users).where(eq(users.id, ownerId));
    actor = await loadActorCtx(db, ownerRow!);
    orgId = actor.orgId;
    const types = await db.select().from(eventTypes).where(and(eq(eventTypes.ownerUserId, ownerId), isNull(eventTypes.deletedAt)));
    for (const slug of ["30min", "60min", "meal"] as const) {
      const row = types.find((x) => x.slug === slug);
      expect(row, slug).toBeTruthy();
      const loaded = await loadEventType(row!.id);
      et[slug] = { id: row!.id, questions: loaded!.questions, locations: row!.locations };
    }
    expect(await db.select().from(workflows).where(eq(workflows.ownerUserId, ownerId))).toHaveLength(3);

    // The token expires within the refresh skew: the first provider call refreshes it under the connection lock.
    const connect = await connectGoogleAccount({
      userId: ownerId,
      providerAccountId: "google-sub-owner",
      accountEmail: OWNER_EMAIL,
      displayName: "Julian Joseph",
      tokens: { accessToken: "stale-access", refreshToken: "refresh-token-1", expiresAt: new Date(T0.getTime() + MIN), scopes: [...GOOGLE_CALENDAR_SCOPES, GMAIL_SEND_SCOPE] },
      via: "connect",
    });
    expect(connect.created).toBe(true);
    expect(connect.destinationSet).toBe(true);
    connectionId = connect.connectionId;
    expect(h.fetchLog.some((l) => l.startsWith("POST https://oauth2.googleapis.com/token"))).toBe(true);
    const cals = await db.select().from(calendars).where(eq(calendars.connectionId, connectionId));
    expect(cals.length).toBeGreaterThan(0);
    primaryCalendarId = cals.find((c) => c.isPrimary)!.id;

    // A second calendar appears at Google; the calendar list job (refresh_calendar_lists -> refresh_calendar_list)
    // and the watch job pick it up.
    fakeCalendarProvider("google").setCalendars(connectionId, [
      { externalId: cals.find((c) => c.isPrimary)!.externalId, name: OWNER_EMAIL, isPrimary: true, canWrite: true },
      { externalId: "family@group.calendar.google.com", name: "Family", isPrimary: false, canWrite: false },
    ]);
    await runHandlerDirectly(db, "calendars.refresh_calendar_list", { connectionId });
    await drain(db, "connect");
    const after = await db.select().from(calendars).where(and(eq(calendars.connectionId, connectionId), isNull(calendars.deletedAt)));
    expect(after).toHaveLength(2);
    expect(await db.select().from(calendarWatchChannels)).not.toHaveLength(0);
    const view = await getCalendarSettingsView(ownerId);
    expect(view).toBeTruthy();
    expect((await getDestinationCalendar(ownerId, et["30min"].id))?.calendarId).toBe(primaryCalendarId);
    await signIn(db, ownerId);
    // The session lookup (several callers swallow its errors, so check it directly).
    expect((await getCurrentUser())?.id).toBe(ownerId);
  });

  it("serves the slots API and Troubleshoot with Google busy times (cache windows, all-day events)", async () => {
    const primary = (await db.select().from(calendars).where(eq(calendars.id, primaryCalendarId)))[0]!;
    const family = (await db.select().from(calendars).where(and(eq(calendars.connectionId, connectionId), eq(calendars.isPrimary, false))))[0]!;
    // Only the primary calendar checks conflicts by default (Calendly): the owner turns the Family calendar on.
    await setConflictCalendars(actor, [{ calendarId: family.id, checked: true }]);
    await setCalendarSyncSettings(actor, { calendarId: family.id, syncChanges: false });
    const g = fakeCalendarProvider("google");
    g.setEvents(connectionId, primary.externalId, [
      { externalId: "dentist", start: la("2031-04-08 12:00"), end: la("2031-04-08 13:00"), title: "Dentist", busy: true },
      { externalId: "lunch-free", start: la("2031-04-09 13:00"), end: la("2031-04-09 14:00"), title: "Optional lunch", busy: false },
    ]);
    g.setEvents(connectionId, family.externalId, [
      { externalId: "trip", start: new Date("2031-04-13T00:00:00Z"), end: new Date("2031-04-14T00:00:00Z"), allDay: true, allDayStartDate: "2031-04-13", allDayEndDate: "2031-04-14", title: "Family trip", busy: true },
    ]);

    // Public request (no session cookie) through the route handler.
    const saved = h.cookies.get(SESSION_COOKIE)!;
    h.cookies.delete(SESSION_COOKIE);
    let body: { days: Record<string, { start: string }[]> };
    try {
      const res = await slotsRoute.GET(
        new Request(`https://kairos.example.com/api/public/slots?${new URLSearchParams({ target: et["30min"].id, start: "2031-04-07", end: "2031-04-20", tz: LA })}`, { headers: { "x-forwarded-for": freshIp() } }),
        undefined,
      );
      expect(res.status).toBe(200);
      body = (await res.json()) as typeof body;
    } finally {
      h.cookies.set(SESSION_COOKIE, saved);
    }
    const tuesday = (body.days["2031-04-08"] ?? []).map((s) => s.start);
    expect(tuesday.length).toBeGreaterThan(0);
    // The dentist (12:00 to 13:00) with the 15 minute buffers blocks 11:45 to 13:15; the all-day family trip blocks Sunday.
    expect(tuesday).not.toContain(la("2031-04-08 12:00").toISOString());
    expect(tuesday).not.toContain(la("2031-04-08 12:45").toISOString());
    expect(body.days["2031-04-13"] ?? []).toEqual([]);

    // The host's troubleshoot=1 (signed in) and the Troubleshoot views.
    const ts = await slotsRoute.GET(
      new Request(`https://kairos.example.com/api/public/slots?${new URLSearchParams({ target: et["30min"].id, start: "2031-04-08", end: "2031-04-08", tz: LA, troubleshoot: "1" })}`, { headers: { "x-forwarded-for": freshIp() } }),
      undefined,
    );
    expect(ts.status).toBe(200);
    const tsBody = JSON.stringify(await ts.json());
    expect(tsBody, "troubleshoot=1 answered as the signed-in host").toContain("Dentist");
    const direct = await publicSlots({ target: et["60min"].id, start: "2031-04-07", end: "2031-05-31", tz: "Europe/Berlin", first: "1" }, { userId: ownerId });
    expect(direct).toBeTruthy();
    const diag = await troubleshootAvailability({ userId: ownerId, organizationId: orgId }, { eventTypeId: et["30min"].id, start: la("2031-04-08 00:00"), end: la("2031-04-09 00:00") });
    expect(JSON.stringify(diag)).toContain("Dentist");
    const day = await getTroubleshootDay(actor, { date: "2031-04-08", eventTypeId: et["30min"].id });
    expect(day).toBeTruthy();
    const allTypes = await getTroubleshootDay(actor, { date: "2031-04-13" });
    expect(allTypes).toBeTruthy();
    const busy = await getExternalBusy({ userIds: [ownerId], start: la("2031-04-07 00:00"), end: la("2031-04-21 00:00") });
    expect(busy[ownerId]?.ok).toBe(true);
    expect(await db.select().from(externalEvents)).not.toHaveLength(0);
    await drain(db, "slots");
  });

  it("books through POST /api/public/bookings and the email verification flow, then provisions Google Meet events", async () => {
    const answer = (slug: "30min" | "60min" | "meal") => et[slug].questions.map((q) => ({ questionId: q.id, value: "Roadmap and hiring" }));
    const book = async (key: string, slug: "30min" | "60min" | "meal", start: Date, email: string, extra: Record<string, unknown> = {}) => {
      const res = await bookingsRoute.POST(
        postJson("https://kairos.example.com/api/public/bookings", {
          target: { kind: "event_type", eventTypeId: et[slug].id },
          start: start.toISOString(),
          invitee: { name: `Guest ${key}`, email, timezone: "America/New_York" },
          answers: answer(slug),
          formToken: await issueBookingFormToken(now().getTime() - 5_000),
          website: "",
          ...extra,
        }, { "x-forwarded-for": freshIp() }),
        undefined,
      );
      const json = (await res.json()) as { ok: boolean; inviteeId: string; scheduledEventId: string; code?: string; message?: string };
      expect(json.ok ? "ok" : JSON.stringify(json), `booking ${key}`).toBe("ok");
      meetings[key] = { inviteeId: json.inviteeId, scheduledEventId: json.scheduledEventId, email };
    };
    await book("m1", "30min", la("2031-04-09 12:00"), "ana@example.org", { guests: ["guest.one@example.org"] });
    await book("m3", "30min", la("2031-04-08 15:00"), "bruno@example.org");
    await book("m5", "30min", la("2031-04-10 17:00"), "carla@example.org");
    await book("m6", "30min", la("2031-04-07 14:00"), "dmitri@example.org");
    const meal = et.meal.locations.find((l) => l.kind === "physical")!;
    // The meal event type uses the "Block Off Work" schedule (Tuesday to Thursday 17:00 to 20:00).
    await book("m4", "meal", la("2031-04-08 17:30"), "eve@example.org", { locationAnswer: { configId: meal.id } });

    // Email verification hold (BK-17): the code email goes out through Gmail, the invitee types it back.
    const hold = await createReservation(
      {
        kind: "email_verification",
        target: { kind: "event_type", eventTypeId: et["60min"].id },
        start: la("2031-04-10 13:00").toISOString(),
        invitee: { name: "Fatima Verified", email: "fatima@example.org", timezone: LA },
        answers: answer("60min"),
      },
      { now: now() },
    );
    expect(hold.ok).toBe(true);
    if (!hold.ok) return;
    await drain(db, "verification code");
    const codeMail = (await outbox(db, { to: "fatima@example.org" })).at(-1);
    const code = /\b(\d{6})\b/.exec(codeMail?.text ?? "")?.[1];
    expect(code, "verification code email").toBeTruthy();
    const verified = await verifyReservationCode(hold.reservationId, code!, { now: now(), rememberDevice: true });
    expect(verified.ok).toBe(true);
    if (verified.ok) meetings.m2 = { inviteeId: verified.inviteeId, scheduledEventId: verified.scheduledEventId, email: "fatima@example.org" };

    // A hold that is never verified expires through booking.reservation_expire.
    const lapsed = await createReservation(
      {
        kind: "email_verification",
        target: { kind: "event_type", eventTypeId: et["30min"].id },
        start: la("2031-04-14 12:00").toISOString(),
        invitee: { name: "Gus Lapsed", email: "gus@example.org", timezone: LA },
        answers: answer("30min"),
      },
      { now: now() },
    );
    expect(lapsed.ok).toBe(true);

    await drain(db, "bookings");
    const linked = await db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.status, "synced"));
    expect(linked.length).toBeGreaterThanOrEqual(6);
    const m1 = (await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, meetings.m1!.scheduledEventId)))[0]!;
    expect(m1.location?.joinUrl).toMatch(/^https:\/\/meet\.example\.com\//);
    expect(h.gmailSent).toBeGreaterThan(5);
  });

  it("runs invitee and host changes: no-show, reschedule, cancel, request reschedule, notes, host-side Google changes", async () => {
    // After m6 started: no-show, unmark, mark again (booking.no_show_created reaches the workflows subscriber).
    advanceTo(la("2031-04-07 15:00"));
    const host = { type: "user" as const, ctx: actor };
    await lifecycle.markNoShow({ inviteeId: meetings.m6!.inviteeId, actor: host });
    await lifecycle.unmarkNoShow({ inviteeId: meetings.m6!.inviteeId, actor: host });
    await lifecycle.markNoShow({ inviteeId: meetings.m6!.inviteeId, actor: host });
    await lifecycle.updateMeetingNotes({ scheduledEventId: meetings.m1!.scheduledEventId, html: "<p>Bring the <strong>Q2 plan</strong></p>", actor: host });

    // Invitee reschedule (m4 to Tuesday evening) and cancel (m3) through their capability links.
    const moved = await lifecycle.rescheduleInvitee({ inviteeId: meetings.m4!.inviteeId, start: la("2031-04-16 17:15").toISOString(), reason: "Traveling that day", actor: { type: "invitee", name: "Eve" } }, { now: now() });
    expect(moved.ok).toBe(true);
    if (moved.ok) meetings.m4 = { inviteeId: moved.inviteeId, scheduledEventId: moved.scheduledEventId, email: meetings.m4!.email };
    await lifecycle.cancelInvitee({ inviteeId: meetings.m3!.inviteeId, actor: { type: "invitee", name: "Bruno" }, reason: "Something came up" });
    // Host asks m5 to pick a new time with a 1 day reminder.
    await lifecycle.requestReschedule({ inviteeId: meetings.m5!.inviteeId, actor: host, message: "Can we find another time?", reminderDays: 1 });
    await drain(db, "invitee changes");

    // Host-side Google changes: m2 moved by an hour in Google Calendar, m4's event deleted.
    const g = fakeCalendarProvider("google");
    const links = await db.select().from(calendarLinkedEvents).where(inArray(calendarLinkedEvents.scheduledEventId, [meetings.m2!.scheduledEventId, meetings.m4!.scheduledEventId]));
    const primary = (await db.select().from(calendars).where(eq(calendars.id, primaryCalendarId)))[0]!;
    const remote = g.events.get(`${connectionId}:${primary.externalId}`) ?? [];
    const m2Link = links.find((l) => l.scheduledEventId === meetings.m2!.scheduledEventId && l.purpose === "meeting");
    expect(m2Link).toBeTruthy();
    const m2Remote = remote.find((e) => e.externalId === m2Link!.externalId)!;
    m2Remote.start = la("2031-04-10 14:00");
    m2Remote.end = la("2031-04-10 15:00");
    m2Remote.updatedAt = now();
    m2Remote.etag = "moved";
    const m4Link = links.find((l) => l.scheduledEventId === meetings.m4!.scheduledEventId && l.purpose === "meeting");
    expect(m4Link).toBeTruthy();
    g.events.set(`${connectionId}:${primary.externalId}`, remote.filter((e) => e.externalId !== m4Link!.externalId));

    // A push notification for the primary calendar (signed with the channel token) triggers calendars.sync_calendar.
    const [channel] = await db.select().from(calendarWatchChannels).where(eq(calendarWatchChannels.calendarId, primaryCalendarId));
    expect(channel).toBeTruthy();
    const push = await googlePushRoute.POST(
      new Request("https://kairos.example.com/api/webhooks/calendars/google", {
        method: "POST",
        headers: { "x-goog-channel-id": channel!.channelId, "x-goog-channel-token": h.channels.get(channel!.channelId)!.token, "x-goog-resource-state": "exists", "x-goog-resource-id": channel!.resourceId ?? "" },
      }),
    );
    expect(push.status).toBe(200);
    // The periodic booked events sync (every 10 minutes) also checks every linked event.
    advance(11 * MIN);
    await drain(db, "host-side changes");
    // A solo meeting moved in Google is rescheduled (CR-17): the old meeting is canceled and a new one, linked to it
    // and to the same provider event, takes the new time.
    const [old] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, meetings.m2!.scheduledEventId));
    expect(old!.status).toBe("canceled");
    const [m2] = await db.select().from(scheduledEvents).where(and(eq(scheduledEvents.rescheduledFromEventId, old!.id), eq(scheduledEvents.status, "active")));
    expect(m2!.startAt.toISOString()).toBe(la("2031-04-10 14:00").toISOString());
    const [m2Invitee] = await db.select().from(invitees).where(and(eq(invitees.scheduledEventId, m2!.id), eq(invitees.status, "active")));
    meetings.m2 = { inviteeId: m2Invitee!.id, scheduledEventId: m2!.id, email: meetings.m2!.email };
    // The deleted event of m4 cancels m4.
    const [m4] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, meetings.m4!.scheduledEventId));
    expect(m4!.status).toBe("canceled");

    // Buffers as busy events on the destination calendar (calendars.linked_event_retry, op "buffers").
    await setCalendarSyncSettings(actor, { calendarId: primaryCalendarId, includeBuffers: true });
    await runHandlerDirectly(db, "calendars.linked_event_retry", { op: "buffers", userId: ownerId, scheduledEventId: meetings.m2!.scheduledEventId });
    await drain(db, "buffers");
  });

  it("changes reminders (backfill) and sends them when due; the request reschedule reminder fires after a day", async () => {
    const before = await getEventTypeReminders(actor, et["30min"].id);
    expect(before).toBeTruthy();
    const saved = await saveEventTypeReminders(actor, {
      eventTypeId: et["30min"].id,
      kind: "invitee",
      enabled: true,
      timings: [{ amount: 24, unit: "hours" }, { amount: 1, unit: "hours" }],
      subject: null,
      bodyHtml: null,
      includeCancelRescheduleLinks: true,
    });
    expect(saved).toBeTruthy();
    await saveEventTypeReminders(actor, {
      eventTypeId: et["60min"].id,
      kind: "host",
      enabled: true,
      timings: [{ amount: 30, unit: "minutes" }],
      subject: null,
      bodyHtml: null,
      includeCancelRescheduleLinks: false,
    });
    await drain(db, "reminder settings");
    // Paged backfill with a cursor (page size 1) over the 30 minute meetings already booked.
    const [wf] = await db.select().from(workflows).where(and(eq(workflows.ownerUserId, ownerId), isNull(workflows.deletedAt))).limit(1);
    await runHandlerDirectly(db, "workflows.backfill", { workflowId: wf!.id, pageSize: 1 });
    await drain(db, "backfill pages");

    // m1 is Wednesday 12:00: the 24 hour reminder is due Tuesday 12:00; the request reschedule reminder for m5 at +1 day.
    advanceTo(la("2031-04-08 12:05"));
    await drain(db, "24h reminders");
    advanceTo(la("2031-04-09 11:05"));
    await drain(db, "1h reminders");
    const reminders = await outbox(db, { to: "ana@example.org" });
    expect(reminders.some((r) => r.template?.startsWith("workflow") || /remind/i.test(r.subject))).toBe(true);
  });

  it("runs meeting polls end to end: holds, invites, votes, comments, deadline, booking, rebooking and cancel", async () => {
    const at = now();
    const opt = (local: string, minutes = 30) => ({ start: la(local).toISOString(), end: new Date(la(local).getTime() + minutes * MIN).toISOString() });
    const poll = await createPoll(actor, {
      title: "Quarterly planning",
      timezone: LA,
      defaultDurationMinutes: 30,
      options: [opt("2031-04-16 14:00"), opt("2031-04-16 15:00"), opt("2031-04-17 14:00"), { date: "2031-04-18" }],
      location: { id: "5eed0000-0000-4000-8000-0000000000c1", kind: "google_conference", position: 0 },
      deadline: new Date(at.getTime() + 2 * DAY).toISOString(),
      reserveTimes: true,
      notifyMode: "instant",
      reminderMode: "custom",
      reminderOffsets: [{ kind: "after_invite", minutes: 60 }, { kind: "before_deadline", minutes: 120 }],
      sendMeetingReminders: true,
      allowComments: true,
      allowIfNeedBe: true,
    });
    const digestPoll = await createPoll(actor, { title: "Team lunch", timezone: LA, defaultDurationMinutes: 60, options: [opt("2031-04-22 12:00", 60), opt("2031-04-23 12:00", 60)], notifyMode: "daily_digest" });
    // Auto-book on consensus (polls.auto_book after each vote) and expiry after its last time (polls.expire).
    const retro = await createPoll(actor, { title: "Retro", timezone: LA, defaultDurationMinutes: 45, options: [opt("2031-05-20 15:00", 45), opt("2031-05-21 15:00", 45)], autoBook: true });
    const holds = await holdsSyncRoute.POST(postJson(`https://kairos.example.com/api/polls/${poll.pollId}/holds/sync`, {}), { params: Promise.resolve({ id: poll.pollId }) });
    expect(holds.status).toBeLessThan(300);
    await invitePeople(actor, { pollId: poll.pollId, recipients: [{ email: "hana@example.org", name: "Hana", required: true }, { email: "ivan@example.org", name: "Ivan" }] });
    await drain(db, "poll invites");

    const options = await db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, poll.pollId)).orderBy(meetingPollOptions.position);
    const [o1, o2] = options;
    // Invited people vote through the personal link of their invitation email (?i=token).
    const inviteToken = async (email: string) => {
      const mail = (await outbox(db, { to: email })).at(-1);
      const token = /[?&](?:amp;)?i=([A-Za-z0-9_-]+)/.exec(`${mail?.html ?? ""} ${mail?.text ?? ""}`)?.[1];
      expect(token, `invite link for ${email}`).toBeTruthy();
      return token!;
    };
    const voter = async (name: string, email: string, choices: [string, "yes" | "if_need_be" | "no"][]) =>
      submitVote(poll.slug, { name, email, timezone: "Europe/Berlin", votes: choices.map(([optionId, choice]) => ({ optionId, choice })) }, { skipBotCheck: true, ip: freshIp(), inviteToken: await inviteToken(email) });
    const okOf = (r: { ok: boolean }) => (r.ok ? "ok" : JSON.stringify(r));
    expect(okOf(await voter("Hana", "hana@example.org", [[o1!.id, "yes"], [o2!.id, "if_need_be"]]))).toBe("ok");
    expect(okOf(await voter("Ivan", "ivan@example.org", [[o1!.id, "yes"], [o2!.id, "no"]]))).toBe("ok");
    const digestOptions = await db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, digestPoll.pollId));
    expect(okOf(await submitVote(digestPoll.slug, { name: "Jo", email: "jo@example.org", timezone: LA, votes: [{ optionId: digestOptions[0]!.id, choice: "yes" }] }, { skipBotCheck: true, ip: freshIp() }))).toBe("ok");
    const retroOptions = await db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, retro.pollId));
    expect(okOf(await submitVote(retro.slug, { name: "Lee", email: "lee@example.org", timezone: LA, votes: retroOptions.map((o) => ({ optionId: o.id, choice: "no" as const })) }, { skipBotCheck: true, ip: freshIp() }))).toBe("ok");
    await addPublicComment(poll.slug, { body: "Either works for me", name: "Ivan" }, { ip: freshIp() });
    await addHostComment(actor, poll.pollId, { body: "Thanks all" });
    await sendReminders(actor, { pollId: poll.pollId });
    await drain(db, "poll votes");

    // Host and voter views, the list, activity, CSV export and the busy overlay.
    expect(await getHostPoll(actor, poll.pollId, { markViewed: true })).toBeTruthy();
    expect(await getVoterView(poll.slug)).toBeTruthy();
    expect(await getPollActivity(actor, poll.pollId, new Date(at.getTime() - HOUR))).not.toHaveLength(0);
    for (const filter of ["open", "all", "booked", "ended", "deleted"] as const) await listPolls(actor, { filter, q: "planning" });
    const csv = await exportPollCsv(actor, poll.pollId, LA);
    expect(csv.csv.length).toBeGreaterThan(0);
    const csvRes = await pollExportRoute.GET(new Request(`https://kairos.example.com/api/polls/${poll.pollId}/export.csv`), { params: Promise.resolve({ id: poll.pollId }) });
    expect(csvRes.status).toBe(200);
    const pub = await publicPollRoute.GET(new Request(`https://kairos.example.com/api/public/polls/${poll.slug}`), { params: Promise.resolve({ slug: poll.slug }) });
    expect(pub.status).toBe(200);
    const busy = await pollBusyRoute.GET(new Request(`https://kairos.example.com/api/polls/busy?${new URLSearchParams({ start: la("2031-04-14 00:00").toISOString(), end: la("2031-04-21 00:00").toISOString() })}`), undefined);
    expect(busy.status).toBeLessThan(500);

    // Hourly digest, the before-deadline reminder and the deadline itself.
    advanceTo(new Date(at.getTime() + 2 * DAY - 90 * MIN));
    await drain(db, "poll reminders and digest");
    advanceTo(new Date(at.getTime() + 2 * DAY + 5 * MIN));
    await drain(db, "poll deadline");
    const [closed] = await db.select().from(meetingPolls).where(eq(meetingPolls.id, poll.pollId));
    expect(closed!.status).not.toBe("open");

    // Book the winner, then rebook it on the second time (an in-place move plus the rebook job).
    const participants = await db.select().from(meetingPollParticipants).where(eq(meetingPollParticipants.pollId, poll.pollId));
    const voters: { participantId: string | null; name: string | null; email: string }[] = participants
      .filter((p) => p.email)
      .map((p) => ({ participantId: p.id, name: p.name, email: p.email! }));
    // The Book dialog presets "Send meeting reminders" from the poll setting (bookingPreview).
    const booked = await bookPoll(actor, { pollId: poll.pollId, optionId: o1!.id, invitees: voters, message: "See you there", sendMeetingReminders: true });
    expect(booked.mode).toBe("booked");
    await drain(db, "poll booked");
    // A different time needs the poll reopened first (MP-21), then the meeting moves in place and Kim is added.
    await reopenPoll(actor, { pollId: poll.pollId, deadline: new Date(now().getTime() + DAY).toISOString(), notify: true });
    await drain(db, "poll reopened");
    const rebooked = await bookPoll(actor, {
      pollId: poll.pollId,
      optionId: o2!.id,
      invitees: [...voters, { participantId: null, name: "Kim", email: "kim@example.org" }],
      sendMeetingReminders: true,
      notifyExcluded: true,
    });
    expect(rebooked.mode).toBe("rebooked");
    await drain(db, "poll rebooked");
    // "Send meeting reminders": 24 hours before the booked time (Wednesday 15:00).
    advanceTo(la("2031-04-15 15:05"));
    await drain(db, "poll meeting reminder");

    // The poll meeting is canceled by an invitee: the polls subscriber reopens the poll's state.
    const [pollMeeting] = await db.select().from(scheduledEvents).where(and(eq(scheduledEvents.pollId, poll.pollId), eq(scheduledEvents.status, "active")));
    expect(pollMeeting).toBeTruthy();
    const [pollInvitee] = await db.select().from(invitees).where(and(eq(invitees.scheduledEventId, pollMeeting!.id), eq(invitees.status, "active"))).limit(1);
    await lifecycle.cancelInvitee({ inviteeId: pollInvitee!.id, actor: { type: "invitee", name: "Hana" }, reason: "Out sick" });
    await drain(db, "poll meeting canceled");

    // Close and delete the digest poll (purged 30 days later, below).
    await closeVoting(actor, digestPoll.pollId);
    await deletePoll(actor, { pollId: digestPoll.pollId, notify: true });
    await drain(db, "poll deleted");
    meetings.pollMeeting = { inviteeId: pollInvitee!.id, scheduledEventId: pollMeeting!.id, email: "hana@example.org" };
  });

  it("lists meetings (tabs, filters, search, cursor pages) and exports the CSV through the route", async () => {
    for (const qs of [
      "tab=upcoming",
      "tab=past",
      "tab=range&start=2031-04-01&end=2031-04-30",
      "tab=upcoming&status=canceled",
      "tab=upcoming&status=active,canceled",
      `tab=upcoming&et=${et["30min"].id}`,
      "tab=upcoming&q=ana",
      "tab=upcoming&emails=ana@example.org,eve@example.org",
    ]) {
      const page = await loadMeetingsPage(actor, parseMeetingsQuery(new URLSearchParams(qs)), { db, now: now() });
      expect(page, qs).toBeTruthy();
    }
    // Enough meetings for a second page (25 per page): bookings through the real service on later days.
    const answer = et["30min"].questions.map((q) => ({ questionId: q.id, value: "Catch up" }));
    const { createBooking } = await import("@/lib/booking/create");
    let made = 0;
    for (const dayOffset of [14, 15, 16, 17, 20, 21, 22]) {
      for (const hour of [12, 13, 14, 15]) {
        const start = new Date(la("2031-04-08 00:00").getTime() + dayOffset * DAY + hour * HOUR);
        const r = await createBooking(
          { target: { kind: "event_type", eventTypeId: et["30min"].id }, start: start.toISOString(), invitee: { name: `Bulk ${made}`, email: `bulk${made}@example.org`, timezone: LA }, answers: answer },
          { now: now() },
        );
        if (r.ok) made++;
      }
    }
    expect(made).toBeGreaterThan(25);
    await drain(db, "bulk bookings");
    const first = await loadMeetingsPage(actor, parseMeetingsQuery(new URLSearchParams("tab=upcoming")), { db, now: now() });
    expect(first.total).toBeGreaterThan(25);
    expect(first.pager.next, "a second page").toBeTruthy();
    const second = await loadMeetingsPage(actor, parseMeetingsQuery(new URLSearchParams({ tab: "upcoming", after: first.pager.next!.after, page: "2" })), { db, now: now() });
    expect(second.from).toBe(26);
    expect(second.pager.prev).toBeTruthy();
    if (second.pager.prev?.before) {
      const back = await loadMeetingsPage(actor, parseMeetingsQuery(new URLSearchParams({ tab: "upcoming", before: second.pager.prev.before, page: "1" })), { db, now: now() });
      expect(back.from).toBe(1);
    }

    let text = "";
    for await (const line of exportCsvLines(actor, parseMeetingsQuery(new URLSearchParams("tab=upcoming&status=active,canceled")), { db, now: now() })) text += line;
    expect(text.split("\n").length).toBeGreaterThan(made);
    const res = await exportRoute.GET(new Request("https://kairos.example.com/api/meetings/export?tab=past"), undefined);
    expect(await readCsv(res)).toContain("Invitee Email");

    // Availability pages and host-level meeting limits (owner priority 2).
    const page = await loadSchedulesPage({ id: ownerId, timezone: LA, timeFormat: "12h", weekStart: 0, locale: "en" });
    expect(page).toBeTruthy();
    await setMeetingLimits(db, ownerId, { day: 3, week: 10, month: null });
    expect(await getMeetingLimits(ownerId)).toMatchObject({ day: 3, week: 10 });
    const counts = await countHostMeetings(ownerId, "2031-04-22");
    expect(counts).toBeTruthy();
    const limited = await publicSlots({ target: et["30min"].id, start: "2031-04-21", end: "2031-04-25", tz: LA }, null);
    expect(limited).toBeTruthy();
    await setMeetingLimits(db, ownerId, { day: null, week: null, month: null });
  });

  it("dispatches through /api/cron (authorized and open mode) and retries a failed Gmail send", async () => {
    // Gmail answers 500 for the next send: the email fails, email.retry backs off and delivers it.
    h.gmailFailures = 1;
    const [m] = await db.select().from(scheduledEvents).where(and(eq(scheduledEvents.eventTypeId, et["60min"].id), eq(scheduledEvents.status, "active"))).limit(1);
    if (m) await lifecycle.cancelScheduledEvent({ scheduledEventId: m.id, actor: { type: "user", ctx: actor }, reason: "Conflict" });
    const authorized = await cronRoute.GET(new Request("https://kairos.example.com/api/cron", { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }));
    expect(authorized.status).toBe(200);
    const body = (await authorized.json()) as { ok: boolean; failed: number };
    expect(body.ok).toBe(true);
    const failedNow = await db.select().from(emailOutbox).where(eq(emailOutbox.status, "failed"));
    expect(failedNow.length).toBeGreaterThan(0);
    advance(10 * MIN);
    await drain(db, "email retry", { allow: [/backend error|gmail/i] });
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.status, "failed"))).toEqual([]);

    // Open mode: throttled by the cron_open_lease (one run per minute across instances).
    const secret = env.CRON_SECRET;
    delete env.CRON_SECRET;
    try {
      const open = await cronRoute.GET(new Request("https://kairos.example.com/api/cron"));
      expect(open.status).toBe(200);
      const throttled = await cronRoute.GET(new Request("https://kairos.example.com/api/cron"));
      expect(((await throttled.json()) as { skipped?: string }).skipped).toBe("throttled");
    } finally {
      env.CRON_SECRET = secret;
    }
  });

  it("holds emails while Google needs a reconnect, sends the connection problem email, then releases them", async () => {
    const g = fakeCalendarProvider("google");
    // A transient provider failure is counted on the connection (recordConnectionFailure) and releases the windows.
    await db.execute(sql`update calendar_sync_windows set fetched_at = ${new Date(0).toISOString()}::timestamptz`);
    g.failNext = { kind: "transient", count: 1 };
    await getExternalBusy({ userIds: [ownerId], start: la("2031-05-01 00:00"), end: la("2031-05-08 00:00") });
    const [afterTransient] = await db.select().from(calendarConnections).where(eq(calendarConnections.id, connectionId));
    expect(afterTransient!.consecutiveFailures).toBeGreaterThan(0);
    expect(await db.select().from(calendarSyncWindows).where(isNotNull(calendarSyncWindows.fetchLeaseHolder))).toEqual([]);
    expect((await db.select().from(calendarSyncWindows).where(isNotNull(calendarSyncWindows.error))).length).toBeGreaterThan(0);
    g.failNext = { kind: "auth", count: 1 };
    // A provider auth failure during a busy refresh marks the connection needs_reauth (calendars.connection_problem).
    await db.update(calendars).set({ checkConflicts: true }).where(eq(calendars.connectionId, connectionId));
    await db.execute(sql`update calendar_sync_windows set fetched_at = ${new Date(0).toISOString()}::timestamptz`);
    await getExternalBusy({ userIds: [ownerId], start: la("2031-05-01 00:00"), end: la("2031-05-08 00:00") });
    const [conn] = await db.select().from(calendarConnections).where(eq(calendarConnections.id, connectionId));
    expect(conn!.status).toBe("needs_reauth");
    await drain(db, "connection problem");
    // While Gmail cannot send, booking emails wait in the outbox (failed with the hold reason).
    const [victim] = await db
      .select({ id: invitees.id })
      .from(invitees)
      .innerJoin(scheduledEvents, eq(scheduledEvents.id, invitees.scheduledEventId))
      .where(and(eq(invitees.status, "active"), eq(scheduledEvents.status, "active"), sql`${invitees.email} like 'bulk%'`))
      .limit(1);
    await lifecycle.cancelInvitee({ inviteeId: victim!.id, actor: { type: "invitee", name: "Bulk" }, reason: "Plans changed" });
    await drain(db, "emails held");
    const held = await db.select().from(emailOutbox).where(eq(emailOutbox.status, "failed"));
    expect(held.map((r) => r.template)).toContain("calendar_connection_problem");
    expect(held.length).toBeGreaterThan(1);
    // Reconnect: the held emails go out on the next email.retry sweep.
    await connectGoogleAccount({
      userId: ownerId,
      providerAccountId: "google-sub-owner",
      accountEmail: OWNER_EMAIL,
      tokens: { accessToken: "new-access", refreshToken: "refresh-token-2", expiresAt: new Date(now().getTime() + 50 * MIN), scopes: [...GOOGLE_CALENDAR_SCOPES, GMAIL_SEND_SCOPE] },
      via: "connect",
    });
    advance(16 * MIN);
    await drain(db, "held emails released");
    // Held booking emails went out; the connection problem notice was out of date by then and is given up.
    const left = await db.select().from(emailOutbox).where(eq(emailOutbox.status, "failed"));
    expect(left.map((r) => r.template)).toEqual(["calendar_connection_problem"]);
    expect(left[0]!.lastError).toMatch(/out of date/);
    for (const r of held.filter((x) => x.template !== "calendar_connection_problem")) {
      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, r.id));
      expect(row!.status, `${r.template} released`).toBe("sent");
    }
  });

  it("runs the handlers no flow above enqueues with realistic payloads", async () => {
    const [anyMeeting] = await db.select().from(scheduledEvents).where(and(eq(scheduledEvents.status, "active"), isNull(scheduledEvents.pollId))).limit(1);
    expect(anyMeeting).toBeTruthy();
    const [poll] = await db.select().from(meetingPolls).where(isNull(meetingPolls.deletedAt)).limit(1);
    const missing = () => registeredJobTypes().filter((type) => !succeededTypes.has(type) && !directTypes.has(type));
    const fixtures: Record<string, () => Record<string, unknown>> = {
      "lifecycle.provision_retry": () => ({ scheduledEventId: anyMeeting!.id, op: "calendar" }),
      "lifecycle.meeting_moved": () => ({ scheduledEventId: anyMeeting!.id, fromStart: anyMeeting!.startAt.toISOString(), fromEnd: anyMeeting!.endAt.toISOString(), sequence: anyMeeting!.icsSequence }),
      "lifecycle.request_reschedule_reminder": () => ({ inviteeId: meetings.m5!.inviteeId, days: 1 }),
      "calendars.connection_problem": () => ({ userId: ownerId }),
      "calendars.sync_calendar": () => ({ calendarId: primaryCalendarId }),
      "calendars.watch_connection": () => ({ connectionId }),
      "calendars.linked_event_retry": () => ({ op: "buffers", userId: ownerId, scheduledEventId: anyMeeting!.id }),
      "polls.auto_book": () => ({ pollId: poll!.id }),
      "polls.notify_subscribers": () => ({ pollId: poll!.id, from: new Date(now().getTime() - DAY).toISOString(), to: now().toISOString() }),
      "polls.holds_sync": () => ({ pollId: poll!.id, refresh: true }),
      "polls.expire": () => ({ pollId: poll!.id, lastStart: now().toISOString() }),
      "workflows.backfill": () => ({ workflowId: "00000000-0000-4000-8000-000000000000" }),
      "files.delete_blob": () => ({ url: "https://store.public.blob.vercel-storage.com/kairos/missing.ics" }),
      "sms.retry": () => ({}),
      "booking.reservation_expire": () => ({}),
    };
    for (const type of missing()) {
      const fixture = fixtures[type];
      if (!fixture) continue;
      await runHandlerDirectly(db, type, fixture());
    }
    await drain(db, "direct handlers");
    // lifecycle.cancel_user_meetings and calendars.revoke_token run in the next step (they end the account's data).
    expect(missing().filter((type) => type !== "lifecycle.cancel_user_meetings" && type !== "calendars.revoke_token"), "registered job types that never ran (add a flow or a fixture here)").toEqual([]);
  });

  it("cancels the owner's remaining meetings in batches, disconnects Google and revokes the token", async () => {
    await runHandlerDirectly(db, "lifecycle.cancel_user_meetings", { userId: ownerId, scope: "sole_host", reason: "Account closing", batch: 0 });
    await drain(db, "cancel user meetings");
    const stillActive = await db.select().from(scheduledEvents).where(and(eq(scheduledEvents.status, "active"), sql`${scheduledEvents.startAt} > ${now().toISOString()}::timestamptz`));
    expect(stillActive).toEqual([]);
    const out = await disconnectConnection(actor, connectionId);
    expect(out.revokeJobId).toBeTruthy();
    await drain(db, "disconnect");
    expect(h.fetchLog.some((l) => l.includes("oauth2.googleapis.com/revoke"))).toBe(true);
  });

  it("purges deleted polls and applies every retention rule of system.cleanup 100 days later", async () => {
    // Rows past every retention window (sessions, rate limits, domain events) plus the history of this run.
    await db.insert(rateLimitBuckets).values({ key: "pg-suite:old", windowStart: new Date(now().getTime() - 5 * DAY), count: 3 }).onConflictDoNothing();
    const beforeJobs = (await db.select({ id: jobs.id }).from(jobs)).length;
    const beforeEvents = (await db.select({ id: domainEvents.id }).from(domainEvents)).length;
    expect(beforeEvents).toBeGreaterThan(0);
    advance(100 * DAY);
    await signIn(db, ownerId);
    const res = await cronRoute.GET(new Request("https://kairos.example.com/api/cron", { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }));
    expect(res.status).toBe(200);
    await drain(db, "cleanup");
    const cleanup = await db.select().from(jobs).where(and(eq(jobs.type, "system.cleanup"), eq(jobs.status, "succeeded")));
    expect(cleanup.length).toBeGreaterThan(0);
    expect((await db.select({ id: jobs.id }).from(jobs)).length).toBeLessThan(beforeJobs);
    expect((await db.select({ id: domainEvents.id }).from(domainEvents)).length).toBeLessThan(beforeEvents);
    expect(await db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.key, "pg-suite:old"))).toEqual([]);
    expect(await db.select().from(sessions).where(sql`${sessions.expiresAt} < ${now().toISOString()}::timestamptz`)).toEqual([]);
    expect(succeededTypes.has(POLL_JOBS.purge)).toBe(true);
  });

  it("every registered job type, periodic job and event subscriber ran successfully; no unexpected network calls", async () => {
    await recordSucceeded(db);
    const ran = new Set([...succeededTypes, ...directTypes]);
    expect(registeredJobTypes().filter((type) => !ran.has(type)), "job types never run").toEqual([]);
    expect(PERIODIC_JOBS.map((p) => p.type).filter((type) => !succeededTypes.has(type)), "periodic jobs never dispatched by the runner").toEqual([]);
    const pairs = Object.entries(SUBSCRIBER_REGISTRY).flatMap(([key, map]) => Object.keys(map).map((type) => `event:${type}:${key}`));
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.filter((p) => !succeededTypes.has(p)), "event subscribers never dispatched").toEqual([]);
    expect(await unhealthyJobs(db)).toEqual([]);
    expect(h.logged.filter((line) => DRIVER_ERROR.test(line)), "driver errors logged by services").toEqual([]);
    const jobErrors = await db.select({ type: jobs.type, lastError: jobs.lastError }).from(jobs).where(isNotNull(jobs.lastError));
    expect(jobErrors.filter((j) => DRIVER_ERROR.test(j.lastError ?? "")), "driver errors recorded on jobs").toEqual([]);
    expect(h.unexpectedFetch).toEqual([]);
  });
});
