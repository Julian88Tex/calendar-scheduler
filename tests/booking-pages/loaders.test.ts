// Booking pages server loaders on PGlite (SPEC BK-01 to BK-03, BK-08, BK-20, BK-22, BK-23, BK-25 to BK-27, CAL-12, CR-04,
// TM-06): the landing page of users and teams, the booking page props (event view, host header, branding, viewer roles,
// deep link check, BK-23 states), /d/{code} canonical redirects, the confirmation view (zone and format of the
// invitee, CAL-12 copy mode, "Open Invitation", rescheduled chains, canceled bookings) and the ICS route.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { scheduledEvents } from "@/db/schema";
import type { WeeklyHours } from "@/db/types";
import type { ResolvedBookingCode } from "@/lib/links";
import type { CreateEventTypeOptions, TestUser } from "../factories";

const state = vi.hoisted(() => ({
  viewer: null as unknown,
  code: null as ResolvedBookingCode | null,
}));

vi.mock("@/lib/calendars", () => ({
  getExternalBusy: async (p: { userIds: string[] }) => Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: [] }])),
  getDestinationCalendar: async () => null,
}));
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => state.code,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getCurrentUser: async () => state.viewer,
}));

const { eq, inArray } = await import("drizzle-orm");
const { eventTypes, instanceSettings, invitees, users } = await import("@/db/schema");
const { loadLanding } = await import("@/components/booking/server/landing");
const { resolveCodePage, resolveEventPage, queryOf } = await import("@/components/booking/server/resolve");
const { loadConfirmation } = await import("@/components/booking/server/confirmation");
const icsRoute = await import("@/app/booking/[inviteeId]/event.ics/route");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { at } = await import("@/lib/slots/testing");
const { useTestDb } = await import("../helpers/db");
const f = await import("../factories");

const t = useTestDb();
const LA = "America/Los_Angeles";
const la = (local: string) => new Date(at(local, LA));
const NOW = la("2030-10-07 06:00"); // Monday morning in Los Angeles
const r = (from: number, to: number) => [{ start: from * 60, end: to * 60 }];
const WEEKDAYS: WeeklyHours = [[], r(9, 17), r(9, 17), r(9, 17), r(9, 17), r(9, 17), []];
const MEET = { id: "5eed0000-0000-4000-8000-000000000201", kind: "google_conference" as const, position: 0 };
let seq = 0;

beforeEach(async () => {
  setFakeNow(NOW);
  await t.db.delete(instanceSettings).where(inArray(instanceSettings.key, ["privacy_policy_url", "terms_url"]));
  state.viewer = null;
  state.code = null;
});
afterEach(() => resetFakeTime());

async function host(opts: { slug?: string; user?: Partial<typeof users.$inferInsert> } = {}) {
  const owner = await f.createUser(t.db, { name: "Ana Lima", timezone: LA, slug: opts.slug ?? `ana-${++seq}`, overrides: opts.user });
  await f.createSchedule(t.db, { userId: owner.id, timezone: LA, weeklyHours: WEEKDAYS });
  return owner;
}

async function eventType(owner: TestUser, opts: Partial<CreateEventTypeOptions> = {}) {
  const { eventType } = await f.createEventType(t.db, {
    owner,
    name: "Intro Call",
    slug: "intro",
    durationMinutes: 30,
    locations: [MEET],
    ...opts,
    overrides: { slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dateRangeType: "rolling", dateRangeDays: 60, ...opts.overrides },
  });
  return eventType;
}

async function ok(handle: string, slug: string, query = "", mode: "calendar" | "details" = "calendar", start: string | null = null) {
  const res = await resolveEventPage(handle, slug, mode, start, query);
  if (!res || res.state !== "ok") throw new Error(`expected an ok page, got ${res ? res.state : "null"}`);
  return res;
}

describe("loadLanding (BK-01, BK-02)", () => {
  it("lists the user's active, public, personal event types in position order", async () => {
    const owner = await host({ slug: "ana-lima" });
    await eventType(owner, { name: "Second", slug: "second", overrides: { position: 2 } });
    await eventType(owner, { name: "First", slug: "first", overrides: { position: 1, descriptionPlain: "  A   short\nchat. " } });
    await eventType(owner, { name: "Secret", slug: "secret", overrides: { position: 0, secret: true } });
    await eventType(owner, { name: "Off", slug: "off", overrides: { position: 0, active: false } });
    const landing = await loadLanding("Ana-Lima");
    expect(landing).toMatchObject({ kind: "user", handle: "ana-lima", name: "Ana Lima", ribbon: true, privacyUrl: null });
    expect(landing!.items.map((i) => [i.name, i.slug, i.description])).toEqual([
      ["First", "first", "A short chat."],
      ["Second", "second", null],
    ]);
    expect(landing!.welcomeMessage).toBe("Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.");
  });

  it("is null for unknown, malformed and deleted handles", async () => {
    const owner = await host({ slug: "gone" });
    expect(await loadLanding("nobody-here")).toBeNull();
    expect(await loadLanding("%E0%A4%A")).toBeNull();
    expect(await loadLanding("bad handle")).toBeNull();
    await t.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, owner.id));
    expect(await loadLanding("gone")).toBeNull();
  });

  it("renders team pages from the teams contract (TM-06)", async () => {
    const member = await host();
    const { team } = await f.createTeam(t.db, { organizationId: member.organizationId, name: "Sales", slug: "sales-team", members: [{ userId: member.id }] });
    await f.createEventType(t.db, { team, name: "Team Intro", slug: "team-intro", poolingType: "round_robin", hosts: [{ userId: member.id }] });
    const landing = await loadLanding("sales-team");
    expect(landing).toMatchObject({ kind: "team", name: "Sales", ribbon: true });
    expect(landing!.items.map((i) => i.slug)).toEqual(["team-intro"]);
  });

  it("uses the host's branding, hidden ribbon and privacy policy link", async () => {
    await t.db.insert(instanceSettings).values({ key: "privacy_policy_url", value: "https://example.com/privacy" });
    const owner = await host({ slug: "branded", user: { brandColors: { primary: "#AA0000" }, showBranding: false, welcomeMessage: "" } });
    void owner;
    const landing = await loadLanding("branded");
    expect(landing).toMatchObject({ branding: { primaryColor: "#aa0000" }, ribbon: false, welcomeMessage: null, privacyUrl: "https://example.com/privacy" });
  });
});

describe("resolveEventPage (BK-03 to BK-08, BK-23, BK-25, BK-26)", () => {
  it("builds the calendar props of a personal event type for an anonymous invitee", async () => {
    const owner = await host();
    const et = await eventType(owner, {
      locations: [
        MEET,
        { id: "5eed0000-0000-4000-8000-000000000202", kind: "physical", position: 1, location: "Cafe Central", displayBeforeBooking: false },
        { id: "5eed0000-0000-4000-8000-000000000203", kind: "inbound_call", position: 2, phoneNumber: "+15551234567" },
      ],
      questions: [
        { label: "What would you like to discuss?", type: "text", required: true },
        { label: "Hidden", type: "string", enabled: false },
      ],
      overrides: { durationOptions: [15, 30, 60], descriptionHtml: "<p>Hello <script>alert(1)</script><b>there</b></p>" },
    });
    const page = await ok(owner.slug!, "INTRO", "back=1&month=2030-11&date=2030-11-04&utm_source=news&name=Ben");
    const p = page.props;
    expect(page.meta).toEqual({ title: "Select a Date & Time", ogTitle: "Ana Lima - Intro Call", ogImage: null, noindex: false });
    expect(p.basePath).toBe(`/${owner.slug}/intro`);
    expect(p.landingPath).toBe(`/${owner.slug}`);
    expect(p.target).toEqual({ kind: "event_type", eventTypeId: et.id });
    expect(p.slotsTarget).toBe(et.id);
    expect(p.event).toMatchObject({ name: "Intro Call", durations: [30, 15, 60], defaultDuration: 30, active: true, secret: false });
    expect(p.event.descriptionHtml).not.toContain("script");
    expect(p.event.descriptionHtml).toBe("<p>Hello <strong>there</strong></p>");
    // The hidden address and the host's inbound number never reach the browser (VID-04, VID-05).
    expect(p.event.locations.map((l) => l.kind)).toEqual(["google_conference", "physical", "inbound_call"]);
    expect(JSON.stringify(p.event.locations)).not.toContain("Cafe Central");
    expect(JSON.stringify(p.event.locations)).not.toContain("5551234567");
    expect(p.event.questions.map((q) => q.label)).toEqual(["What would you like to discuss?"]);
    expect(p.host).toEqual({ variant: "single", person: { id: owner.id, name: "Ana Lima", avatarUrl: null } });
    expect(p.brandHeader).toEqual({ kind: "avatar", src: null, name: "Ana Lima" });
    expect(p.initial).toEqual({ month: "2030-11", date: "2030-11-04", start: null, startAvailable: null, duration: null, back: true });
    expect(p.prefill.name).toBe("Ben");
    expect(p.carry).toEqual([
      ["back", "1"],
      ["utm_source", "news"],
      ["name", "Ben"],
    ]);
    expect(p.viewer).toEqual({ signedIn: false, isHost: false, email: null, editUrl: null, mutual: false });
    expect(p.troubleshootUrl).toBeNull();
    expect(p.preview).toBe(false);
    expect(p.formToken.length).toBeGreaterThan(10);
    expect(p.honeypotName).toBe("website");
    expect(p.hostZone).toBe(LA);
    expect(p.ribbon).toBe(true);
    expect(p.privacyUrl).toBeNull();
    expect(p.termsUrl).toBeNull();
  });

  it("is null for unknown handles and slugs, team types under a user handle, and invalid detail starts", async () => {
    const owner = await host();
    await eventType(owner);
    expect(await resolveEventPage("nobody", "intro", "calendar", null, "")).toBeNull();
    expect(await resolveEventPage(owner.slug!, "nope", "calendar", null, "")).toBeNull();
    expect(await resolveEventPage(owner.slug!, "intro", "details", "not-a-date", "")).toBeNull();
    expect(await resolveEventPage(owner.slug!, "intro", "details", null, "")).toBeNull();
    expect(await resolveEventPage(owner.slug!, "%E0%A4%A", "calendar", null, "")).toBeNull();
  });

  it("checks deep links to a start (BK-08) and keeps a valid duration", async () => {
    const owner = await host();
    await eventType(owner, { overrides: { durationOptions: [30, 60] } });
    const bookable = await ok(owner.slug!, "intro", "duration=60", "details", "2030-10-08T17:00:00Z");
    expect(bookable.meta.title).toBe("Enter Details");
    expect(bookable.meta.noindex).toBe(true);
    expect(bookable.props.initial).toMatchObject({ start: "2030-10-08T17:00:00.000Z", startAvailable: true, duration: 60 });
    const saturday = await ok(owner.slug!, "intro", "duration=45", "details", "2030-10-12T17:00:00Z");
    expect(saturday.props.initial).toMatchObject({ startAvailable: false, duration: null });
  });

  it("turned off event types show the BK-23 state to invitees and the page to the host", async () => {
    const owner = await host();
    await eventType(owner, { overrides: { active: false } });
    const off = await resolveEventPage(owner.slug!, "intro", "calendar", null, "");
    expect(off).toMatchObject({ state: "off", shell: { hostName: "Ana Lima" }, meta: { noindex: true } });
    state.viewer = owner;
    const page = await ok(owner.slug!, "intro");
    expect(page.props.event.active).toBe(false);
    expect(page.meta.noindex).toBe(true);
  });

  it("gives hosts the owner tools: troubleshoot link, edit link and the editor preview", async () => {
    const owner = await host();
    const et = await eventType(owner);
    state.viewer = owner;
    const page = await ok(owner.slug!, "intro", "preview=1");
    expect(page.props.viewer).toEqual({ signedIn: true, isHost: true, email: owner.email, editUrl: `/app/event-types/${et.id}`, mutual: false });
    expect(page.props.troubleshootUrl).toBe(`/app/availability/troubleshoot?eventType=${et.id}`);
    expect(page.props.preview).toBe(true);
    expect(page.props.carry).toEqual([["preview", "1"]]);

    // Anyone else: no preview, no owner tools, mutual availability for signed-in visitors (BK-33).
    const other = await f.createUser(t.db, { timezone: LA });
    state.viewer = other;
    const visitor = await ok(owner.slug!, "intro", "preview=1");
    expect(visitor.props.preview).toBe(false);
    expect(visitor.props.carry).toEqual([]);
    expect(visitor.props.viewer).toEqual({ signedIn: true, isHost: false, email: null, editUrl: null, mutual: true });
    expect(visitor.props.troubleshootUrl).toBeNull();
    const embedded = await ok(owner.slug!, "intro", "embed_domain=example.com&embed_type=Inline");
    expect(embedded.props.viewer.mutual).toBe(false);
  });

  it("applies host branding, display parameters and legal links (BK-25, BK-26, GEN-14)", async () => {
    await t.db.insert(instanceSettings).values([
      { key: "privacy_policy_url", value: "https://example.com/privacy" },
      { key: "terms_url", value: "javascript:alert(1)" },
    ]);
    const owner = await host({ user: { brandColors: { primary: "#0055ff", text: "#111111" }, showBranding: false, metadata: { privacyPolicyUrl: "https://ana.example.com/privacy" } } });
    await eventType(owner, { overrides: { secret: true } });
    const page = await ok(owner.slug!, "intro", "primary_color=ff0000&hide_event_type_details=1");
    expect(page.props.branding).toEqual({ primaryColor: "#ff0000", backgroundColor: null, textColor: "#111111" });
    expect(page.props.embed).toMatchObject({ hideEventTypeDetails: true });
    expect(page.props.ribbon).toBe(false);
    expect(page.props.privacyUrl).toBe("https://ana.example.com/privacy");
    expect(page.props.termsUrl).toBeNull();
    expect(page.meta.noindex).toBe(true); // secret
  });

  it("team event types carry the team identity, never a member's personal branding", async () => {
    const member = await host({ user: { brandColors: { primary: "#00aa00" }, showBranding: false } });
    const second = await f.createUser(t.db, { name: "Ben Ode", timezone: LA });
    await f.createSchedule(t.db, { userId: second.id, timezone: LA, weeklyHours: WEEKDAYS });
    const { team } = await f.createTeam(t.db, { organizationId: member.organizationId, name: "Sales", slug: "sales", members: [{ userId: member.id }, { userId: second.id }] });
    await f.createEventType(t.db, { team, name: "Demo", slug: "demo", poolingType: "collective", hosts: [{ userId: member.id }, { userId: second.id }], locations: [MEET] });
    const page = await ok("sales", "demo");
    expect(page.props.host).toMatchObject({ variant: "stack" });
    expect(page.props.hostName).toBe("Ana Lima, Ben Ode");
    expect(page.props.branding).toEqual({ primaryColor: null, backgroundColor: null, textColor: null });
    expect(page.props.ribbon).toBe(true);
    expect(page.props.initial.back).toBe(false);
    const rr = await f.createEventType(t.db, { team, name: "Intro", slug: "rr", poolingType: "round_robin", hosts: [{ userId: member.id }, { userId: second.id }], locations: [MEET] });
    void rr;
    const rrPage = await ok("sales", "rr");
    expect(rrPage.props.host).toEqual({ variant: "team", name: "Sales", avatarUrl: null });
    expect(rrPage.props.brandHeader).toEqual({ kind: "avatar", src: null, name: "Sales" });
  });
});

describe("resolveCodePage (BK-23, BK-27)", () => {
  it("redirects other slugs to the canonical path with the start and the query", async () => {
    const owner = await host();
    const et = await eventType(owner, { overrides: { scope: "personal" } });
    state.code = { kind: "single_use", code: "AbC123", eventTypeId: et.id, linkId: null, status: "active", currentSlug: "intro" };
    expect(await resolveCodePage("AbC123", null, "calendar", null, "")).toEqual({ state: "redirect", location: "/d/AbC123/intro" });
    expect(await resolveCodePage("AbC123", "old-name", "details", "2030-10-08T17:00:00.000Z", "name=Ben")).toEqual({
      state: "redirect",
      location: "/d/AbC123/intro/2030-10-08T17:00:00Z?name=Ben",
    });
    const page = await resolveCodePage("AbC123", "intro", "calendar", null, "");
    expect(page).toMatchObject({ state: "ok", props: { basePath: "/d/AbC123/intro", landingPath: null, slotsTarget: "AbC123", target: { kind: "single_use", code: "AbC123", eventTypeId: et.id } }, meta: { noindex: true } });
  });

  it("answers the used and expired states, and null for unknown or deleted codes", async () => {
    const owner = await host();
    const et = await eventType(owner);
    expect(await resolveCodePage("zzz", "intro", "calendar", null, "")).toBeNull();
    state.code = { kind: "single_use", code: "used1", eventTypeId: et.id, linkId: null, status: "used", currentSlug: "intro" };
    expect(await resolveCodePage("used1", "intro", "calendar", null, "")).toMatchObject({ state: "used", meta: { noindex: true } });
    state.code = { kind: "one_off", code: "exp1", eventTypeId: et.id, linkId: null, status: "expired", currentSlug: "intro" };
    expect(await resolveCodePage("exp1", "intro", "calendar", null, "")).toMatchObject({ state: "expired" });
    state.code = { kind: "single_use", code: "del1", eventTypeId: et.id, linkId: null, status: "deleted", currentSlug: "intro" };
    expect(await resolveCodePage("del1", "intro", "calendar", null, "")).toBeNull();
  });

  it("serializes search params to a stable query string", () => {
    expect(queryOf({ a: "1", b: ["2", "3"], c: undefined })).toBe("a=1&b=2");
  });
});

describe("loadConfirmation (BK-20, CAL-12, CR-04)", () => {
  async function booked(opts: { notificationType?: "calendar_invitation" | "email_confirmation"; invitee?: Partial<typeof invitees.$inferInsert>; event?: Partial<typeof scheduledEvents.$inferInsert>; status?: "active" | "canceled" } = {}) {
    const owner = await host();
    const et = await eventType(owner, { overrides: { notificationType: opts.notificationType ?? "email_confirmation" } });
    const row = (await t.db.select().from(eventTypes).where(eq(eventTypes.id, et.id)))[0]!;
    const b = await f.createBooking(t.db, {
      eventType: row,
      start: "2030-10-08T17:00:00Z",
      status: opts.status,
      invitee: { name: "Ben Ode", email: "ben@example.com", timezone: "America/New_York", guests: ["guest@example.com"], overrides: opts.invitee },
      location: { configId: MEET.id, kind: "google_conference", location: null, additionalInfo: null, joinUrl: "https://meet.google.com/abc-defg-hij", status: "pushed", providerMeetingId: "abc", password: null, dialIn: null, data: null, error: null },
      overrides: opts.event,
    });
    return { owner, et, ...b };
  }

  it("shows the booking in the invitee's zone and format with the email confirmation copy", async () => {
    const { invitee, owner } = await booked();
    const res = await loadConfirmation(invitee!.id);
    expect(res?.state).toBe("ok");
    const v = res!.state === "ok" ? res!.view : null;
    expect(v).toMatchObject({
      status: "active",
      rescheduled: false,
      past: false,
      eventName: "Intro Call",
      hostNames: ["Ana Lima"],
      scheduledWith: "Ana Lima",
      whenText: "1:00pm - 1:30pm, Tuesday, October 8, 2030",
      zone: "America/New_York",
      zoneName: "Eastern Time - US & Canada",
      mode: "email_confirmation",
      invitationUrl: null,
      icsUrl: `/booking/${invitee!.id}/event.ics`,
      scheduleAnother: { label: "Schedule another event", href: `/${owner.slug}/intro` },
      manage: { cancel: `/cancellations/${invitee!.id}`, reschedule: `/reschedulings/${invitee!.id}` },
      canceled: null,
      guests: ["guest@example.com"],
      location: { icon: "video", text: "Google Meet", detail: "https://meet.google.com/abc-defg-hij", href: "https://meet.google.com/abc-defg-hij" },
    });
    expect(v!.hostAvatar).toEqual({ src: null, name: "Ana Lima" });
    expect(v!.calendarLinks.map((l) => l.id)).toEqual(expect.arrayContaining(["google", "ical"]));
    expect(v!.calendarLinks.find((l) => l.id === "ical")?.url).toBe(`/booking/${invitee!.id}/event.ics`);
    void owner;
  });

  it("uses 24 hour times when the invitee chose them, and the calendar invitation copy with Open Invitation", async () => {
    const { invitee } = await booked({
      notificationType: "calendar_invitation",
      invitee: { timeFormat: "24h", timezone: "Europe/Berlin" },
      event: { invitationUrl: "https://calendar.google.com/calendar/event?eid=abc", providerIcalUid: "provider-uid-123@google.com" },
    });
    const res = await loadConfirmation(invitee!.id);
    const v = res?.state === "ok" ? res.view : null;
    expect(v).toMatchObject({ mode: "calendar_invitation", invitationUrl: "https://calendar.google.com/calendar/event?eid=abc", hour12: false, whenText: "19:00 - 19:30, Tuesday, October 8, 2030", zoneName: "Central European Time" });
  });

  it("redirects old invitee ids of a rescheduled chain to the current booking (CR-04)", async () => {
    const first = await booked();
    const owner = first.owner;
    const row = (await t.db.select().from(eventTypes).where(eq(eventTypes.id, first.et.id)))[0]!;
    const second = await f.createBooking(t.db, { eventType: row, start: "2030-10-09T17:00:00Z", invitee: { email: "ben@example.com", overrides: { oldInviteeId: first.invitee!.id } } });
    await t.db.update(invitees).set({ status: "canceled", newInviteeId: second.invitee!.id }).where(eq(invitees.id, first.invitee!.id));
    expect(await loadConfirmation(first.invitee!.id)).toEqual({ state: "redirect", inviteeId: second.invitee!.id });
    const current = await loadConfirmation(second.invitee!.id);
    expect(current?.state === "ok" && current.view.rescheduled).toBe(true);
    void owner;
  });

  it("shows canceled bookings with the reason and no manage links; past bookings have no manage links", async () => {
    const canceled = await booked({ status: "canceled", event: { cancelReason: "Out sick", canceledByName: "Ana Lima" } });
    const v = await loadConfirmation(canceled.invitee!.id);
    expect(v).toMatchObject({ state: "ok", view: { status: "canceled", manage: null, canceled: { by: "Ana Lima", reason: "Out sick" } } });

    setFakeNow(la("2030-10-09 06:00"));
    const past = await loadConfirmation(canceled.invitee!.id);
    expect(past?.state === "ok" && past.view.past).toBe(true);
  });

  it("is null for unknown and malformed ids", async () => {
    expect(await loadConfirmation("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await loadConfirmation("not-a-uuid")).toBeNull();
  });
});

describe("GET /booking/{inviteeId}/event.ics (BK-22)", () => {
  const get = (id: string) => icsRoute.GET(new Request(`http://localhost:3000/booking/${id}/event.ics`), { params: Promise.resolve({ inviteeId: id }) });

  it("answers the invitee's calendar file with the provider's iCal UID in calendar invitation mode", async () => {
    const owner = await host();
    const et = await eventType(owner, { overrides: { notificationType: "calendar_invitation" } });
    const row = (await t.db.select().from(eventTypes).where(eq(eventTypes.id, et.id)))[0]!;
    const { invitee } = await f.createBooking(t.db, { eventType: row, start: "2030-10-08T17:00:00Z", overrides: { providerIcalUid: "provider-uid-123@google.com" } });
    const res = await get(invitee!.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="[\w.-]+"$/);
    const body = await res.text();
    expect(body).toContain("METHOD:REQUEST");
    expect(body).toContain("UID:provider-uid-123@google.com");
    expect(body).toContain("DTSTART:20301008T170000Z");
  });

  it("answers CANCEL for canceled bookings and 404 for unknown invitees", async () => {
    const owner = await host();
    const et = await eventType(owner, { overrides: { notificationType: "email_confirmation" } });
    const row = (await t.db.select().from(eventTypes).where(eq(eventTypes.id, et.id)))[0]!;
    const { invitee, scheduledEvent } = await f.createBooking(t.db, { eventType: row, start: "2030-10-08T17:00:00Z", status: "canceled" });
    const res = await get(invitee!.id);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("METHOD:CANCEL");
    expect(body).toContain(`UID:${scheduledEvent.icsUid}`);
    expect((await get("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await get("nope")).status).toBe(404);
  });
});
