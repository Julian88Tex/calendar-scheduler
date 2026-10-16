// Meeting email helpers (SPEC NT-05, NT-06, NT-20, BK-22): the meeting ICS from the schema (UID rules, SEQUENCE,
// organizer, attendees, title, description), sender identity with the no-reply setting, host branding, and the
// "Add to calendar" links.
import ical, { type VEvent } from "node-ical";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { scheduledEvents, users } from "@/db/schema";
import type { ResolvedLocation } from "@/db/types";
import { addToCalendarLinks, buildMeetingIcs, emailBrandForUser, googleCalendarUrl, meetingSender, outlookCalendarUrl } from "@/lib/email";
import { createBooking, createEventType, createUser } from "../factories";
import { useTestDb } from "../helpers/db";

const t = useTestDb();
let seq = 0;

const zoom: ResolvedLocation = {
  configId: null,
  kind: "zoom_conference",
  location: null,
  additionalInfo: null,
  joinUrl: "https://zoom.us/j/123",
  status: "pushed",
  providerMeetingId: "123",
  password: null,
  dialIn: null,
  data: null,
  error: null,
};

async function meeting(opts: { group?: boolean } = {}) {
  seq++;
  const host = await createUser(t.db, { name: "Jordan Lee", email: `host${seq}@example.com`, timezone: "America/New_York" });
  const cohost = await createUser(t.db, { name: "Casey Co", email: `co${seq}@example.com`, organizationId: host.organizationId });
  const { eventType } = await createEventType(t.db, {
    owner: host,
    name: "Strategy Session",
    kind: opts.group ? "group" : "solo",
    maxInvitees: opts.group ? 5 : 1,
  });
  const booking = await createBooking(t.db, {
    eventType,
    start: "2026-11-02T15:00:00Z",
    location: zoom,
    hosts: [
      { userId: host.id, role: "organizer" },
      { userId: cohost.id, role: "cohost" },
    ],
    invitee: {
      name: "Sam Rivera",
      email: `sam${seq}@example.com`,
      guests: [`guest${seq}@example.com`],
      questionsAndAnswers: [{ questionId: "q", question: "Topic", type: "text", position: 1, answer: "Roadmap" }],
    },
    overrides: { icsSequence: 3 },
  });
  return { host, cohost, eventType, ...booking, invitee: booking.invitee! };
}

const parse = (ics: string) => Object.values(ical.sync.parseICS(ics)).find((c): c is VEvent => c?.type === "VEVENT")!;

describe("buildMeetingIcs (NT-06)", () => {
  it("one-on-one: the meeting UID and SEQUENCE, organizer, invitee, guests and co-hosts, title and description", async () => {
    const m = await meeting();
    const ics = (await buildMeetingIcs({ scheduledEventId: m.scheduledEvent.id, inviteeId: m.invitee.id, method: "REQUEST" }))!;
    expect(ics).toMatchObject({ uid: m.scheduledEvent.icsUid, sequence: 3, method: "REQUEST", filename: "invite.ics" });
    const ev = parse(ics.content);
    expect(ev.uid).toBe(m.scheduledEvent.icsUid);
    expect(Number(ev.sequence)).toBe(3);
    expect(ev.summary).toBe("Strategy Session with Jordan Lee");
    expect(ev.start.toISOString()).toBe("2026-11-02T15:00:00.000Z");
    expect(ev.location).toBe("https://zoom.us/j/123");
    const desc = String(ev.description);
    expect(desc).toContain("Event Name: Strategy Session");
    expect(desc).toContain("Location: https://zoom.us/j/123");
    expect(desc).toContain(`Join link: http://localhost:3000/events/${m.scheduledEvent.id}/join`);
    expect(desc).toContain("Questions:\nTopic\nRoadmap");
    expect(desc).toContain(`Need to make changes to this event?\nCancel: http://localhost:3000/cancellations/${m.invitee.id}`);
    expect(desc).toContain("Powered by Kairos");
    const organizer = ev.organizer as unknown as { val: string; params: { CN: string } };
    expect(organizer.val.toLowerCase()).toBe(`mailto:${m.host.email}`);
    const attendees = ([] as { val: string }[]).concat(ev.attendee as never).map((a) => a.val.toLowerCase().replace("mailto:", ""));
    expect(attendees).toEqual([m.invitee.email, `guest${seq}@example.com`, m.cohost.email]);
  });

  it("cancellation: same UID, METHOD CANCEL, STATUS CANCELLED and no manage links", async () => {
    const m = await meeting();
    const ics = (await buildMeetingIcs({ scheduledEventId: m.scheduledEvent.id, inviteeId: m.invitee.id, method: "CANCEL", sequence: 4 }))!;
    expect(ics.content).toContain("METHOD:CANCEL");
    const ev = parse(ics.content);
    expect(ev.uid).toBe(m.scheduledEvent.icsUid);
    expect(Number(ev.sequence)).toBe(4);
    expect(ev.status).toBe("CANCELLED");
    expect(String(ev.description)).not.toContain("Need to make changes");
  });

  it("group invitees get their own UID and only their own attendee line", async () => {
    const m = await meeting({ group: true });
    const ics = (await buildMeetingIcs({ scheduledEventId: m.scheduledEvent.id, inviteeId: m.invitee.id, method: "REQUEST" }))!;
    expect(ics.uid).toBe(`${m.invitee.id}@localhost`);
  });

  it("calendar invitation meetings use the provider iCal UID; titles come from the template; branding off hides Powered by", async () => {
    const m = await meeting();
    await t.db
      .update(scheduledEvents)
      .set({
        providerIcalUid: "google-ical-uid-1@google.com",
        settingsSnapshot: {
          ...m.scheduledEvent.settingsSnapshot,
          notificationMode: "calendar_invitation",
          includeCancelRescheduleLinks: false,
          templates: { inviteeEventTitle: "{{event_name}} ({{invitee_first_name}})" },
        },
      })
      .where(eq(scheduledEvents.id, m.scheduledEvent.id));
    await t.db.update(users).set({ showBranding: false }).where(eq(users.id, m.host.id));
    const ics = (await buildMeetingIcs({ scheduledEventId: m.scheduledEvent.id, inviteeId: m.invitee.id, method: "PUBLISH" }))!;
    expect(ics.uid).toBe("google-ical-uid-1@google.com");
    const ev = parse(ics.content);
    expect(ev.summary).toBe("Strategy Session (Sam)");
    expect(String(ev.description)).not.toContain("Need to make changes");
    expect(String(ev.description)).not.toContain("Powered by");
    expect(ics.content).not.toContain("ATTENDEE");
  });

  it("host copies use the CAL-11 host calendar title (or the host title template) and keep the invitee as attendee", async () => {
    const solo = await meeting();
    // Several hosts: "{{event_name}} with {{invitee_full_name}}".
    const multi = (await buildMeetingIcs({ scheduledEventId: solo.scheduledEvent.id, method: "REQUEST", audience: "host" }))!;
    expect(parse(multi.content).summary).toBe("Strategy Session with Sam Rivera");
    expect(String(parse(multi.content).description)).toContain(`Cancel: http://localhost:3000/cancellations/${solo.invitee.id}`);
    const attendees = ([] as { val: string }[]).concat(parse(multi.content).attendee as never).map((a) => a.val.toLowerCase());
    expect(attendees).toContain(`mailto:${solo.invitee.email}`);
    // A custom host title template wins.
    await t.db
      .update(scheduledEvents)
      .set({ settingsSnapshot: { ...solo.scheduledEvent.settingsSnapshot, templates: { hostEventTitle: "{{invitee_full_name}} / {{event_name}}" } } })
      .where(eq(scheduledEvents.id, solo.scheduledEvent.id));
    const custom = (await buildMeetingIcs({ scheduledEventId: solo.scheduledEvent.id, inviteeId: solo.invitee.id, method: "REQUEST", audience: "host" }))!;
    expect(parse(custom.content).summary).toBe("Sam Rivera / Strategy Session");
    // One host, one-on-one: "{{invitee_full_name}} and {{my_name}}".
    seq++;
    const host = await createUser(t.db, { name: "Riley Host", email: `solo${seq}@example.com` });
    const { eventType } = await createEventType(t.db, { owner: host, name: "Intro" });
    const b = await createBooking(t.db, { eventType, start: "2026-11-03T15:00:00Z", invitee: { name: "Ana Diaz", email: `ana${seq}@example.com` } });
    const one = (await buildMeetingIcs({ scheduledEventId: b.scheduledEvent.id, method: "REQUEST", audience: "host" }))!;
    expect(parse(one.content).summary).toBe("Ana Diaz and Riley Host");
    // Group slots: the event name.
    const g = await meeting({ group: true });
    const group = (await buildMeetingIcs({ scheduledEventId: g.scheduledEvent.id, method: "REQUEST", audience: "host" }))!;
    expect(parse(group.content).summary).toBe("Strategy Session");
  });

  it("calendar invitation mode: the host's invitation description template replaces the generated details", async () => {
    const m = await meeting();
    await t.db
      .update(scheduledEvents)
      .set({
        settingsSnapshot: {
          ...m.scheduledEvent.settingsSnapshot,
          notificationMode: "calendar_invitation",
          templates: { invitationDescription: "<p>Hi {{invitee_first_name}} &amp; team,</p><p>Agenda: <strong>{{event_name}}</strong></p>" },
        },
      })
      .where(eq(scheduledEvents.id, m.scheduledEvent.id));
    const ics = (await buildMeetingIcs({ scheduledEventId: m.scheduledEvent.id, inviteeId: m.invitee.id, method: "PUBLISH" }))!;
    const desc = String(parse(ics.content).description);
    expect(desc).toContain("Hi Sam & team,");
    expect(desc).toContain("Agenda: Strategy Session");
    expect(desc).not.toContain("Event Name:");
    expect(desc).not.toContain("<p>");
    // The manage links and the footer still follow the meeting settings.
    expect(desc).toContain("Need to make changes to this event?");
    expect(desc).toContain("Powered by Kairos");
  });

  it("returns null for a missing meeting", async () => {
    expect(await buildMeetingIcs({ scheduledEventId: "00000000-0000-4000-8000-000000000999", method: "REQUEST" })).toBeNull();
  });
});

describe("meetingSender (NT-20) and branding (NT-05)", () => {
  it("uses '{Host} via {AppName}' and the host email, and omits Reply-To with the no-reply setting", async () => {
    const host = await createUser(t.db, { name: "Jordan Lee", email: "jordan.sender@example.com" });
    expect(await meetingSender({ hostUserId: host.id, audience: "invitee" })).toEqual({
      fromName: "Jordan Lee via Kairos",
      replyTo: "jordan.sender@example.com",
    });
    await t.db
      .update(users)
      .set({ notificationPrefs: { ...host.notificationPrefs, noReplyInviteeEmails: true } })
      .where(eq(users.id, host.id));
    expect(await meetingSender({ hostUserId: host.id, audience: "invitee" })).toEqual({ fromName: "Jordan Lee via Kairos", replyTo: null });
    // A workflow's explicit reply-to is kept.
    expect((await meetingSender({ hostUserId: host.id, audience: "invitee", replyTo: "team@example.com" })).replyTo).toBe("team@example.com");
    expect(await meetingSender({ hostUserId: host.id, audience: "host", replyTo: "sam@example.com" })).toEqual({ fromName: "Kairos", replyTo: "sam@example.com" });
  });

  it("brand: logo over avatar, provider avatar fallback, Powered by from the branding setting", async () => {
    const host = await createUser(t.db, { overrides: { avatarUrl: "https://lh3.googleusercontent.com/a/x", showBranding: false } });
    expect(await emailBrandForUser(host.id)).toEqual({ logoUrl: null, avatarUrl: "https://lh3.googleusercontent.com/a/x", showPoweredBy: false });
    expect(await emailBrandForUser(null)).toEqual({ showPoweredBy: true });
  });
});

describe("Add to calendar links (BK-22)", () => {
  const input = {
    title: "Strategy Session with Jordan Lee",
    start: new Date("2026-11-02T15:00:00Z"),
    end: new Date("2026-11-02T15:30:00Z"),
    location: "https://zoom.us/j/123",
    details: "Need to make changes?",
  };

  it("Google and Outlook template URLs carry UTC times, title, location and details", () => {
    const g = new URL(googleCalendarUrl(input));
    expect(g.origin + g.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(g.searchParams.get("action")).toBe("TEMPLATE");
    expect(g.searchParams.get("dates")).toBe("20261102T150000Z/20261102T153000Z");
    expect(g.searchParams.get("text")).toBe(input.title);
    expect(g.searchParams.get("location")).toBe(input.location);
    const o = new URL(outlookCalendarUrl(input));
    expect(o.hostname).toBe("outlook.live.com");
    expect(o.searchParams.get("startdt")).toBe("2026-11-02T15:00:00Z");
    expect(o.searchParams.get("enddt")).toBe("2026-11-02T15:30:00Z");
    expect(o.searchParams.get("subject")).toBe(input.title);
    const allDay = new URL(googleCalendarUrl({ ...input, allDayDate: "2026-12-31" }));
    expect(allDay.searchParams.get("dates")).toBe("20261231/20270101");
  });

  it("returns the four links with labels", () => {
    const links = addToCalendarLinks({ ...input, icsUrl: "http://localhost:3000/booking/abc/event.ics" });
    expect(links.map((l) => l.label)).toEqual(["Google", "Outlook.com", "Office 365", "Apple / iCal"]);
    expect(links[2]!.url).toContain("outlook.office.com");
    expect(links[3]!.url).toBe("http://localhost:3000/booking/abc/event.ics");
  });
});
