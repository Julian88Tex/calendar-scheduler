// The Meetings page read model on PGlite (SPEC MT-01, MT-02, MT-05 to MT-08, MT-13, MT-15; ARCHITECTURE 18.7): tabs
// at their boundaries and across zones, date groups, filters and search, keyset pages with the counter, deep links,
// visibility and per-meeting access (viewers cannot cancel), and the details blocks built from seeded data.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { ResolvedLocation } from "@/db/types";
import type { TestUser } from "../factories";

const { eventTypePermissions, invitees, scheduledEvents, users } = await import("@/db/schema");
const { loadActorCtx } = await import("@/lib/authz");
const { parseMeetingsQuery } = await import("@/lib/meetings/filters");
const { loadMeetingsPage } = await import("@/lib/meetings/queries");
const { useTestDb } = await import("../helpers/db");
const f = await import("../factories");

const t = useTestDb();
const LA = "America/Los_Angeles";
const NOW = new Date("2030-10-07T13:00:00Z"); // Monday 06:00 in Los Angeles
const H = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const MEET: ResolvedLocation = { configId: null, kind: "google_conference", location: null, additionalInfo: null, joinUrl: "https://meet.google.com/abc-defg-hij", status: "pushed", providerMeetingId: null, password: null, dialIn: null, data: null, error: null };

let owner: TestUser;
let seq = 0;

beforeEach(async () => {
  owner = await f.createUser(t.db, { name: "Julian Joseph", timezone: LA, slug: `julian-${++seq}` });
});

async function actorOf(u: TestUser) {
  const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
  return loadActorCtx(t.db, row!);
}

async function page(u: TestUser, qs = "") {
  return loadMeetingsPage(await actorOf(u), parseMeetingsQuery(new URLSearchParams(qs)), { db: t.db, now: NOW });
}

const ids = (data: Awaited<ReturnType<typeof page>>) => data.groups.flatMap((g) => g.meetings.map((m) => m.id));

async function eventType(name = "30 Minute Virtual", slug = `30min-${++seq}`, u: TestUser = owner) {
  return (await f.createEventType(t.db, { owner: u, name, slug })).eventType;
}

describe("tabs", () => {
  it("puts a meeting that ended 5 minutes ago in Past, not Upcoming (MT-02)", async () => {
    const et = await eventType();
    const ended = await f.createBooking(t.db, { eventType: et, start: at(-35 * 60_000) });
    const later = await f.createBooking(t.db, { eventType: et, start: at(2 * H) });
    const live = await f.createBooking(t.db, { eventType: et, start: at(-10 * 60_000) }); // in progress
    expect(ids(await page(owner))).toEqual([live.scheduledEvent.id, later.scheduledEvent.id]);
    expect(ids(await page(owner, "tab=past"))).toEqual([ended.scheduledEvent.id]);
  });

  it("sorts Upcoming soonest first and Past newest first", async () => {
    const et = await eventType();
    const a = await f.createBooking(t.db, { eventType: et, start: at(-50 * H) });
    const b = await f.createBooking(t.db, { eventType: et, start: at(-26 * H) });
    const c = await f.createBooking(t.db, { eventType: et, start: at(26 * H) });
    const d = await f.createBooking(t.db, { eventType: et, start: at(50 * H) });
    expect(ids(await page(owner))).toEqual([c.scheduledEvent.id, d.scheduledEvent.id]);
    expect(ids(await page(owner, "tab=past"))).toEqual([b.scheduledEvent.id, a.scheduledEvent.id]);
  });

  it("groups by day in the viewer's zone with Calendly date headers", async () => {
    const et = await eventType();
    // Tuesday, October 8 at 4:00pm and 5:30pm in Los Angeles: different UTC days.
    await f.createBooking(t.db, { eventType: et, start: "2030-10-08T23:00:00Z" });
    await f.createBooking(t.db, { eventType: et, start: "2030-10-09T00:30:00Z" });
    await f.createBooking(t.db, { eventType: et, start: "2030-10-09T18:00:00Z" });
    const data = await page(owner);
    expect(data.groups.map((g) => [g.label, g.meetings.map((m) => m.timeRange)])).toEqual([
      ["Tuesday, October 8, 2030", ["4:00pm - 4:30pm", "5:30pm - 6:00pm"]],
      ["Wednesday, October 9, 2030", ["11:00am - 11:30am"]],
    ]);
  });

  it("uses the owner's 24-hour clock and DD/MM dates", async () => {
    await t.db.update(users).set({ timeFormat: "24h", dateFormat: "DD/MM/YYYY" }).where(eq(users.id, owner.id));
    const et = await eventType();
    await f.createBooking(t.db, { eventType: et, start: "2030-10-08T23:00:00Z" });
    const data = await page(owner);
    expect(data.groups[0]!.label).toBe("Tuesday, 8 October 2030");
    expect(data.groups[0]!.meetings[0]!.timeRange).toBe("16:00 - 16:30");
  });

  it("lists the Date Range by local dates in the viewer's zone, ascending", async () => {
    const et = await eventType();
    const late = await f.createBooking(t.db, { eventType: et, start: "2030-10-10T06:30:00Z" }); // Oct 9, 11:30pm LA
    const early = await f.createBooking(t.db, { eventType: et, start: "2030-10-09T07:00:00Z" }); // Oct 9, 0:00 LA
    await f.createBooking(t.db, { eventType: et, start: "2030-10-09T06:30:00Z" }); // Oct 8, 11:30pm LA
    await f.createBooking(t.db, { eventType: et, start: "2030-10-10T07:00:00Z" }); // Oct 10 LA
    const data = await page(owner, "tab=range&start=2030-10-09&end=2030-10-09");
    expect(ids(data)).toEqual([early.scheduledEvent.id, late.scheduledEvent.id]);
    expect(data.query).toMatchObject({ tab: "range", start: "2030-10-09", end: "2030-10-09" });
  });

  it("defaults the Date Range to this month", async () => {
    const data = await page(owner, "tab=range");
    expect(data.query).toMatchObject({ start: "2030-10-01", end: "2030-10-31" });
    expect(data.groups).toEqual([]);
  });
});

describe("filters and search (MT-08)", () => {
  it("filters by event type and Status Canceled", async () => {
    const a = await eventType("30 Minute Virtual");
    const b = await eventType("60 Minute Virtual");
    const keep = await f.createBooking(t.db, { eventType: a, start: at(5 * H), status: "canceled" });
    await f.createBooking(t.db, { eventType: a, start: at(6 * H) });
    await f.createBooking(t.db, { eventType: b, start: at(7 * H), status: "canceled" });
    const data = await page(owner, `eventTypes=${a.id}&status=canceled`);
    expect(ids(data)).toEqual([keep.scheduledEvent.id]);
    expect(data.groups[0]!.meetings[0]!).toMatchObject({ status: "canceled", rescheduled: false });
    expect(data.eventTypes.map((e) => e.name)).toEqual(["30 Minute Virtual", "60 Minute Virtual"]);
  });

  it("shows only active events by default and both when asked", async () => {
    const et = await eventType();
    await f.createBooking(t.db, { eventType: et, start: at(5 * H), status: "canceled" });
    await f.createBooking(t.db, { eventType: et, start: at(6 * H) });
    expect((await page(owner)).total).toBe(1);
    expect((await page(owner, "status=active,canceled")).total).toBe(2);
  });

  it("filters by invitee emails and searches invitee names, emails and event names", async () => {
    const et = await eventType("Intro Call");
    const other = await eventType("Coffee Chat");
    const maya = await f.createBooking(t.db, { eventType: et, start: at(5 * H), invitee: { name: "Maya Patel", email: "maya.patel@example.com" } });
    const dan = await f.createBooking(t.db, { eventType: other, start: at(6 * H), invitee: { name: "Daniel Okafor", email: "dan@example.com" } });
    expect(ids(await page(owner, "emails=MAYA.PATEL@example.com"))).toEqual([maya.scheduledEvent.id]);
    expect(ids(await page(owner, "q=okaf"))).toEqual([dan.scheduledEvent.id]);
    expect(ids(await page(owner, "q=dan%40example"))).toEqual([dan.scheduledEvent.id]);
    expect(ids(await page(owner, "q=coffee"))).toEqual([dan.scheduledEvent.id]);
    // LIKE wildcards are literal.
    expect(ids(await page(owner, "q=%25"))).toEqual([]);
  });
});

describe("pagination (MT-15)", () => {
  it("shows 25 meetings on page 1 and 5 on page 2 with the counter", async () => {
    const et = await eventType();
    for (let i = 0; i < 30; i++) await f.createBooking(t.db, { eventType: et, start: at((i + 1) * H) });
    const p1 = await page(owner);
    expect(ids(p1)).toHaveLength(25);
    expect(p1).toMatchObject({ total: 30, from: 1, to: 25 });
    expect(p1.pager.prev).toBeNull();
    expect(p1.pager.next?.page).toBe(2);
    const p2 = await page(owner, `after=${p1.pager.next!.after}&page=2`);
    expect(ids(p2)).toHaveLength(5);
    expect(p2).toMatchObject({ total: 30, from: 26, to: 30 });
    expect(p2.pager.next).toBeNull();
    expect(p2.pager.prev).toEqual({ before: null, page: 1 });
    expect(new Set([...ids(p1), ...ids(p2)]).size).toBe(30);
  });

  it("goes back a page with a before cursor", async () => {
    const et = await eventType();
    for (let i = 0; i < 60; i++) await f.createBooking(t.db, { eventType: et, start: at((i + 1) * H) });
    const p1 = await page(owner);
    const p2 = await page(owner, `after=${p1.pager.next!.after}&page=2`);
    const p3 = await page(owner, `after=${p2.pager.next!.after}&page=3`);
    expect(ids(p3)).toHaveLength(10);
    expect(p3.pager.prev?.before).toBeTruthy();
    const back = await page(owner, `before=${p3.pager.prev!.before}&page=2`);
    expect(ids(back)).toEqual(ids(p2));
    expect(back).toMatchObject({ from: 26, to: 50 });
    expect(back.pager.next?.page).toBe(3);
  });

  it("restarts at page 1 for a stale or forged cursor", async () => {
    const et = await eventType();
    await f.createBooking(t.db, { eventType: et, start: at(H) });
    const data = await page(owner, "after=bm90LWEtY3Vyc29y&page=4");
    expect(data.query.page).toBe(1);
    expect(data.from).toBe(1);
  });
});

describe("deep links (?event=)", () => {
  it("opens the page that holds the meeting", async () => {
    const et = await eventType();
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push(await f.createBooking(t.db, { eventType: et, start: at((i + 1) * H) }));
    const target = rows[27]!.scheduledEvent.id;
    const data = await page(owner, `event=${target}`);
    expect(data.query).toMatchObject({ page: 2, event: target });
    expect(ids(data)).toContain(target);
    expect(data.from).toBe(26);
  });

  it("opens Past for an ended meeting and adds canceled events for a canceled one", async () => {
    const et = await eventType();
    const past = await f.createBooking(t.db, { eventType: et, start: at(-30 * H) });
    const canceled = await f.createBooking(t.db, { eventType: et, start: at(30 * H), status: "canceled" });
    expect((await page(owner, `event=${past.scheduledEvent.id}`)).query).toMatchObject({ tab: "past", event: past.scheduledEvent.id });
    const c = await page(owner, `event=${canceled.scheduledEvent.id}`);
    expect(c.query).toMatchObject({ tab: "upcoming", status: ["active", "canceled"], event: canceled.scheduledEvent.id });
    expect(ids(c)).toContain(canceled.scheduledEvent.id);
  });

  it("pins a meeting the explicit filters hide", async () => {
    const et = await eventType();
    const upcoming = await f.createBooking(t.db, { eventType: et, start: at(30 * H) });
    const data = await page(owner, `tab=past&event=${upcoming.scheduledEvent.id}`);
    expect(data.groups).toEqual([]);
    expect(data.pinned?.id).toBe(upcoming.scheduledEvent.id);
    expect(data.query.event).toBe(upcoming.scheduledEvent.id);
  });

  it("reports an unknown or foreign meeting", async () => {
    const stranger = await f.createUser(t.db);
    const theirs = await f.createBooking(t.db, { eventType: await eventType("Theirs", `theirs-${++seq}`, stranger), start: at(5 * H) });
    const data = await page(owner, `event=${theirs.scheduledEvent.id}`);
    expect(data.eventNotFound).toBe(true);
    expect(data.pinned).toBeNull();
    expect(data.query.event).toBeNull();
  });
});

describe("visibility and access (MT-07)", () => {
  it("lists only the viewer's meetings, never another organization's", async () => {
    const mine = await f.createBooking(t.db, { eventType: await eventType(), start: at(5 * H) });
    const colleague = await f.createUser(t.db, { organizationId: owner.organizationId });
    await f.createBooking(t.db, { eventType: await eventType("Theirs", `theirs-${++seq}`, colleague), start: at(6 * H) });
    const stranger = await f.createUser(t.db);
    await f.createBooking(t.db, { eventType: await eventType("Other org", `other-${++seq}`, stranger), start: at(7 * H) });
    expect(ids(await page(owner))).toEqual([mine.scheduledEvent.id]);
  });

  it("gives event type viewers a view-only row without actions or notes", async () => {
    const et = await eventType();
    const booked = await f.createBooking(t.db, { eventType: et, start: at(5 * H), overrides: { meetingNotesHtml: "<p>Private</p>", meetingNotesPlain: "Private" } });
    const viewer = await f.createUser(t.db, { organizationId: owner.organizationId });
    await t.db.insert(eventTypePermissions).values({ eventTypeId: et.id, userId: viewer.id, level: "view" });
    const row = (await page(viewer)).groups[0]!.meetings[0]!;
    expect(row.id).toBe(booked.scheduledEvent.id);
    expect(row).toMatchObject({ access: "view", canCancel: false, canReschedule: false, canRetry: false, notesHtml: null, summary: null, editEventTypeHref: null });
    const mine = (await page(owner)).groups[0]!.meetings[0]!;
    expect(mine).toMatchObject({ access: "manage", canCancel: true, canReschedule: true, notesHtml: "<p>Private</p>", editEventTypeHref: `/app/event-types/${et.id}` });
    expect(mine.summary).toMatchObject({ scheduledEventId: booked.scheduledEvent.id, timeZone: LA, hour12: true, eventTypeBookable: true });
  });

  it("lets editors with edit permission manage", async () => {
    const et = await eventType();
    await f.createBooking(t.db, { eventType: et, start: at(5 * H) });
    const editor = await f.createUser(t.db, { organizationId: owner.organizationId });
    await t.db.insert(eventTypePermissions).values({ eventTypeId: et.id, userId: editor.id, level: "edit" });
    expect((await page(editor)).groups[0]!.meetings[0]!).toMatchObject({ access: "manage", canCancel: true });
  });
});

describe("details (MT-06)", () => {
  it("renders every block from the meeting's data", async () => {
    const et = await eventType();
    const booked = await f.createBooking(t.db, {
      eventType: et,
      start: at(5 * H),
      location: MEET,
      invitee: {
        name: "Maya Patel",
        email: "maya.patel@example.com",
        timezone: "America/New_York",
        guests: ["guest.one@example.com", "guest.two@example.com"],
        questionsAndAnswers: [{ questionId: null, question: "What would you like to discuss?", type: "text", position: 0, answer: "Roadmap review" }],
        overrides: { utmSource: "newsletter" },
      },
      overrides: { createdAt: new Date("2030-10-01T18:00:00Z") },
    });
    const m = (await page(owner)).groups[0]!.meetings[0]!;
    expect(m).toMatchObject({ id: booked.scheduledEvent.id, title: "Maya Patel", eventName: "30 Minute Virtual", hostsLabel: "1 host | 2 non-hosts", createdLabel: "Created 10/01/2030 by Maya Patel", ended: false });
    expect(m.people[0]).toMatchObject({
      email: "maya.patel@example.com",
      timeZoneLabel: "Eastern Time - US & Canada",
      questions: [{ question: "What would you like to discuss?", answer: "Roadmap review" }],
      tracking: [{ label: "UTM source", value: "newsletter" }],
      noShow: false,
    });
    expect([...m.people[0]!.guests].sort()).toEqual(["guest.one@example.com", "guest.two@example.com"]);
    expect(m.location).toMatchObject({ text: "Google Meet", joinHref: `/events/${booked.scheduledEvent.id}/join` });
    expect(m.hosts).toEqual([{ id: owner.id, name: "Julian Joseph", avatarUrl: null }]);
    expect(m.notices).toEqual([]);
    expect(m.scheduleAgainHref).toBeNull();
  });

  it("omits empty blocks", async () => {
    const et = await eventType();
    await f.createBooking(t.db, { eventType: et, start: at(5 * H), invitee: { overrides: { timezone: null } } });
    const m = (await page(owner)).groups[0]!.meetings[0]!;
    expect(m.location).toBeNull();
    expect(m.people[0]).toMatchObject({ timeZoneLabel: null, questions: [], guests: [], tracking: [] });
    expect(m.notesHtml).toBeNull();
  });

  it("shows who canceled and why, with Schedule Invitee Again", async () => {
    const et = await eventType();
    await f.createBooking(t.db, {
      eventType: et,
      start: at(5 * H),
      status: "canceled",
      invitee: { name: "Maya Patel", email: "maya@example.com" },
      overrides: { cancelerType: "host", canceledByUserId: owner.id, cancelReason: "Something came up" },
    });
    const m = (await page(owner, "status=canceled")).groups[0]!.meetings[0]!;
    expect(m.notices).toEqual([{ kind: "canceled", tone: "danger", text: "Canceled by Julian Joseph (host)", details: ["Reason: Something came up"], link: null }]);
    expect(m).toMatchObject({ canCancel: false, canReschedule: false });
    expect(m.scheduleAgainHref).toBe(`/${owner.slug}/${et.slug}?name=Maya+Patel&email=maya%40example.com`);
  });

  it("links a rescheduled meeting to its new time and back", async () => {
    const et = await eventType();
    const next = await f.createBooking(t.db, { eventType: et, start: at(30 * H), invitee: { name: "Maya Patel" } });
    const old = await f.createBooking(t.db, {
      eventType: et,
      start: at(5 * H),
      status: "canceled",
      invitee: { name: "Maya Patel", overrides: { rescheduled: true, newInviteeId: next.invitee!.id, cancelerType: "invitee", rescheduleReason: "Conflict" } },
    });
    await t.db.update(invitees).set({ oldInviteeId: old.invitee!.id }).where(eq(invitees.id, next.invitee!.id));
    const data = await page(owner, "status=active,canceled");
    const byId = new Map(data.groups.flatMap((g) => g.meetings).map((m) => [m.id, m]));
    const o = byId.get(old.scheduledEvent.id)!;
    expect(o.rescheduled).toBe(true);
    expect(o.notices[0]).toMatchObject({ kind: "rescheduled_to", text: "Rescheduled to 12:00pm - 12:30pm, Tuesday, October 8, 2030", details: ["Rescheduled by Maya Patel (invitee)", "Reason: Conflict"], link: { label: "View new time", eventId: next.scheduledEvent.id } });
    expect(o.scheduleAgainHref).toBeNull();
    const n = byId.get(next.scheduledEvent.id)!;
    expect(n.notices[0]).toMatchObject({ kind: "rescheduled_from", text: "Rescheduled from 11:00am - 11:30am, Monday, October 7, 2030", link: { label: "View former time", eventId: old.scheduledEvent.id } });
  });

  it("offers Retry for a failed Google Meet link", async () => {
    const et = await eventType();
    await f.createBooking(t.db, { eventType: et, start: at(5 * H), location: { ...MEET, joinUrl: null, status: "failed", error: "not_configured" } });
    const m = (await page(owner)).groups[0]!.meetings[0]!;
    expect(m.canRetry).toBe(true);
    expect(m.location?.problem).toBe("Google Meet isn't available on this server.");
  });

  it("marks no-shows and shows Schedule Invitee Again on past meetings", async () => {
    const et = await eventType();
    const b = await f.createBooking(t.db, { eventType: et, start: at(-3 * H) });
    await f.markNoShow(t.db, b.invitee!.id);
    const m = (await page(owner, "tab=past")).groups[0]!.meetings[0]!;
    expect(m.people[0]!.noShow).toBe(true);
    expect(m.ended).toBe(true);
    expect(m.scheduleAgainHref).toContain(`/${owner.slug}/${et.slug}?`);
    expect(m).toMatchObject({ canCancel: false, canReschedule: false });
  });

  it("shows a group slot as one row with its seat count (MT-13)", async () => {
    const { eventType: group } = await f.createEventType(t.db, { owner, name: "Workshop", kind: "group", maxInvitees: 5 });
    await f.createBooking(t.db, { eventType: group, start: at(5 * H), invitees: [{ name: "Ana" }, { name: "Ben" }, { name: "Cy", status: "canceled" }] });
    const data = await page(owner);
    expect(ids(data)).toHaveLength(1);
    expect(data.groups[0]!.meetings[0]!).toMatchObject({ title: "2 invitees", spotsLabel: "2 of 5 spots filled", isGroup: true });
    expect(data.groups[0]!.meetings[0]!.people.map((p) => p.name)).toEqual(["Ana", "Ben"]);
  });

  it("badges meetings booked from a poll", async () => {
    const et = await eventType();
    await f.createBooking(t.db, { eventType: et, start: at(5 * H), source: "poll" });
    expect((await page(owner)).groups[0]!.meetings[0]!.isPoll).toBe(true);
  });

  it("offers Share your link with the landing page", async () => {
    const data = await page(owner);
    expect(data.groups).toEqual([]);
    expect(data.shareUrl).toBe(`http://localhost:3000/${owner.slug}`);
  });
});

describe("meeting rows of other statuses", () => {
  it("never shows a meeting of another organization even through a forged event type filter", async () => {
    const stranger = await f.createUser(t.db);
    const et = await eventType("Other org", `other-${++seq}`, stranger);
    await f.createBooking(t.db, { eventType: et, start: at(5 * H) });
    expect((await page(owner, `eventTypes=${et.id}`)).total).toBe(0);
    await t.db.update(scheduledEvents).set({ organizerUserId: owner.id }).where(eq(scheduledEvents.eventTypeId, et.id));
    // Organizer id alone does not cross organizations.
    expect((await page(owner, `eventTypes=${et.id}`)).total).toBe(0);
  });
});
