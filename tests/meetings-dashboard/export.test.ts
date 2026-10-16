// CSV export on PGlite (SPEC MT-11, CR-14): the exact header and one row per invitee for the current tab and filters,
// canceled invitees only with "Canceled events", meeting notes only for meetings the viewer manages, and the GET
// route (sign-in required, a CSV download). Plus the "Retry" Server Action (signed-in hosts only, other tenants'
// meetings are not found). Other modules' contracts that the action reaches are mocked.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestUser } from "../factories";

const session = vi.hoisted(() => ({ user: null as unknown }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const { AppError } = await import("@/lib/errors");
  return {
    ...(await importOriginal<typeof import("@/lib/auth/session")>()),
    getSession: async () => (session.user ? { session: { id: "s", twoFactorPending: false }, user: session.user } : null),
    getCurrentUser: async () => session.user,
    requireUser: async () => {
      if (!session.user) throw new AppError("unauthorized");
      return session.user;
    },
    touchSession: async () => {},
  };
});
vi.mock("@/lib/calendars", () => ({
  getExternalBusy: async () => ({}),
  getDestinationCalendar: async () => null,
  upsertLinkedEvent: async () => ({ status: "skipped_no_calendar" }),
  deleteLinkedEvent: async () => {},
}));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { eventTypePermissions, jobs, scheduledEvents, users } = await import("@/db/schema");
const { loadActorCtx } = await import("@/lib/authz");
const { CSV_HEADER } = await import("@/lib/meetings/csv");
const { exportCsvLines } = await import("@/lib/meetings/export");
const { parseMeetingsQuery } = await import("@/lib/meetings/filters");
const { GET } = await import("@/app/api/meetings/export/route");
const { retryMeetingProvisioningAction } = await import("@/lib/meetings/actions");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const f = await import("../factories");

const t = useTestDb();
const NOW = new Date("2030-10-07T13:00:00Z");
const H = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
let owner: TestUser;
let seq = 0;

beforeEach(async () => {
  resetFakeTime();
  setFakeNow(NOW);
  session.user = null;
  owner = await f.createUser(t.db, { name: "Julian Joseph", email: `julian-${++seq}@example.com`, timezone: "America/Los_Angeles", slug: `jj-${seq}` });
});

async function rowOf(u: TestUser) {
  const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
  return row!;
}

async function csv(u: TestUser, qs = ""): Promise<string[][]> {
  const actor = await loadActorCtx(t.db, await rowOf(u));
  let text = "";
  for await (const line of exportCsvLines(actor, parseMeetingsQuery(new URLSearchParams(qs)), { db: t.db, now: NOW })) text += line;
  expect(text.startsWith("﻿")).toBe(true);
  return parseCsv(text.slice(1));
}

/** Minimal RFC 4180 parser for the assertions. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  return rows;
}

const col = (rows: string[][], name: string) => rows.slice(1).map((r) => r[CSV_HEADER.indexOf(name)]);

describe("exportCsvLines", () => {
  it("has the MT-11 header and one row per invitee", async () => {
    const { eventType } = await f.createEventType(t.db, { owner, name: "30 Minute Virtual" });
    const { eventType: group } = await f.createEventType(t.db, { owner, name: "Workshop", kind: "group", maxInvitees: 5 });
    await f.createBooking(t.db, { eventType, start: at(5 * H), invitee: { name: "Maya Patel", email: "maya@example.com", guests: ["g@example.com"] } });
    await f.createBooking(t.db, { eventType: group, start: at(6 * H), invitees: [{ name: "Ana" }, { name: "Ben" }] });
    const rows = await csv(owner);
    expect(rows[0]).toEqual([...CSV_HEADER]);
    expect(rows).toHaveLength(4);
    expect(col(rows, "Invitee Name")).toEqual(["Maya Patel", "Ana", "Ben"]);
    expect(col(rows, "Event Type Name")).toEqual(["30 Minute Virtual", "Workshop", "Workshop"]);
    expect(col(rows, "Group")).toEqual(["false", "true", "true"]);
    expect(col(rows, "User Name")).toEqual(["Julian Joseph", "Julian Joseph", "Julian Joseph"]);
    expect(col(rows, "Guest Email(s)")[0]).toBe("g@example.com");
    expect(col(rows, "Start Date & Time")[0]).toBe("2030-10-07 11:00:00 -07:00");
  });

  it("follows the tab and the Status filter", async () => {
    const { eventType } = await f.createEventType(t.db, { owner });
    await f.createBooking(t.db, { eventType, start: at(-5 * H), invitee: { name: "Past" } });
    await f.createBooking(t.db, { eventType, start: at(5 * H), invitee: { name: "Upcoming" } });
    await f.createBooking(t.db, {
      eventType,
      start: at(6 * H),
      status: "canceled",
      invitee: { name: "Canceled", overrides: { cancelerType: "invitee", cancelReason: "Sick" } },
    });
    expect(col(await csv(owner), "Invitee Name")).toEqual(["Upcoming"]);
    expect(col(await csv(owner, "tab=past"), "Invitee Name")).toEqual(["Past"]);
    const both = await csv(owner, "status=active,canceled");
    expect(col(both, "Invitee Name")).toEqual(["Upcoming", "Canceled"]);
    expect(col(both, "Canceled")).toEqual(["false", "true"]);
    expect(col(both, "Canceled By")).toEqual(["", "Canceled"]);
    expect(col(both, "Cancellation Reason")).toEqual(["", "Sick"]);
  });

  it("exports notes only for meetings the viewer manages, and no-shows", async () => {
    const { eventType } = await f.createEventType(t.db, { owner });
    const b = await f.createBooking(t.db, { eventType, start: at(-5 * H), overrides: { meetingNotesHtml: "<p>Owner only</p>", meetingNotesPlain: "Owner only" } });
    await f.markNoShow(t.db, b.invitee!.id);
    expect(col(await csv(owner, "tab=past"), "Meeting Notes")).toEqual(["Owner only"]);
    expect(col(await csv(owner, "tab=past"), "Marked as No-Show")).toEqual(["true"]);
    const viewer = await f.createUser(t.db, { organizationId: owner.organizationId });
    await t.db.insert(eventTypePermissions).values({ eventTypeId: eventType.id, userId: viewer.id, level: "view" });
    expect(col(await csv(viewer, "tab=past"), "Meeting Notes")).toEqual([""]);
  });

  it("never exports another user's meetings", async () => {
    const stranger = await f.createUser(t.db);
    const { eventType } = await f.createEventType(t.db, { owner: stranger });
    await f.createBooking(t.db, { eventType, start: at(5 * H) });
    expect(await csv(owner)).toHaveLength(1);
  });
});

describe("GET /api/meetings/export", () => {
  it("requires a signed-in user", async () => {
    const res = await GET(new Request("http://localhost:3000/api/meetings/export"), undefined);
    expect(res.status).toBe(401);
  });

  it("downloads the CSV of the tab and filters", async () => {
    const { eventType } = await f.createEventType(t.db, { owner, name: "Intro" });
    await f.createBooking(t.db, { eventType, start: at(-5 * H), invitee: { name: "Maya Patel" } });
    session.user = await rowOf(owner);
    const res = await GET(new Request("http://localhost:3000/api/meetings/export?tab=past"), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="meetings-past-2030-10-07.csv"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const rows = parseCsv((await res.text()).replace(/^﻿/, ""));
    expect(rows).toHaveLength(2);
    expect(col(rows, "Invitee Name")).toEqual(["Maya Patel"]);
  });
});

describe("retryMeetingProvisioningAction", () => {
  it("refuses signed-out callers and other tenants' meetings", async () => {
    const { eventType } = await f.createEventType(t.db, { owner });
    const b = await f.createBooking(t.db, { eventType, start: at(5 * H) });
    const anon = await retryMeetingProvisioningAction({ scheduledEventId: b.scheduledEvent.id });
    expect(anon).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    session.user = await rowOf(await f.createUser(t.db));
    const foreign = await retryMeetingProvisioningAction({ scheduledEventId: b.scheduledEvent.id });
    expect(foreign).toMatchObject({ ok: false, error: { code: "not_found" } });
    const bad = await retryMeetingProvisioningAction({ scheduledEventId: "nope" });
    expect(bad).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("queues provisioning again for the host", async () => {
    const { eventType } = await f.createEventType(t.db, { owner });
    const b = await f.createBooking(t.db, {
      eventType,
      start: at(5 * H),
      location: { configId: null, kind: "google_conference", location: null, additionalInfo: null, joinUrl: null, status: "failed", providerMeetingId: null, password: null, dialIn: null, data: null, error: "not_configured" },
      overrides: { provisionStatus: "partial" },
    });
    session.user = await rowOf(owner);
    const r = await retryMeetingProvisioningAction({ scheduledEventId: b.scheduledEvent.id });
    expect(r).toEqual({ ok: true, data: { scheduledEventId: b.scheduledEvent.id } });
    const [m] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, b.scheduledEvent.id));
    expect(m!.provisionStatus).toBe("pending");
    const queued = await t.db.select().from(jobs).where(eq(jobs.type, "lifecycle.provision_retry"));
    expect(queued.length).toBeGreaterThan(0);
  });
});
