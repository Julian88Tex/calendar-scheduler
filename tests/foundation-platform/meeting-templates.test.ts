// Calendly-style meeting emails (SPEC NT-01 to NT-04, NT-09, NT-05, BK-22): renderMeetingEmail structure and copy for
// every kind, custom subject and body templates, escaping, and the NT-01 acceptance with a real template context
// (the invitee's zone and the cancel URL).
import { describe, expect, it } from "vitest";
import type { ResolvedLocation } from "@/db/types";
import { addToCalendarLinks, renderMeetingEmail, meetingDateTimeLine, type MeetingEmailInput } from "@/lib/email";
import { buildMeetingTemplateContext } from "@/lib/template-context";
import { TEMPLATE_PREVIEW_CONTEXT } from "@/lib/template";
import { createBooking, createEventType, createUser } from "../factories";
import { useTestDb } from "../helpers/db";

const t = useTestDb();

const meet: Pick<ResolvedLocation, "kind" | "location" | "additionalInfo" | "joinUrl"> = {
  kind: "google_conference",
  location: null,
  additionalInfo: null,
  joinUrl: "https://meet.google.com/abc-defg-hij",
};

const ctx = { ...TEMPLATE_PREVIEW_CONTEXT };
const brand = { showPoweredBy: true, avatarUrl: "https://cdn.example.com/a.png" };
const render = (over: Partial<MeetingEmailInput> & Pick<MeetingEmailInput, "kind">) =>
  renderMeetingEmail({ ctx, brand, location: meet, questions: [{ question: "What would you like to discuss?", answer: "Roadmap\nBudget" }], ...over });

describe("renderMeetingEmail", () => {
  it("invitee confirmation: Calendly subject, greeting, sentence, details, manage links and Add to calendar", () => {
    const calendar = addToCalendarLinks({
      title: "30 Minute Meeting with Jordan Lee",
      start: new Date("2026-10-20T14:00:00Z"),
      end: new Date("2026-10-20T14:30:00Z"),
      icsUrl: "https://example.com/booking/x/event.ics",
    });
    const e = render({ kind: "invitee_confirmation", addToCalendar: calendar });
    expect(e.subject).toBe("Confirmed: 30 Minute Meeting with Jordan Lee on Tuesday, October 20, 2026");
    expect(e.text).toContain("Hi Sam,");
    expect(e.text).toContain(
      "Your 30 Minute Meeting with Jordan Lee at 10:00am (Eastern Time - US & Canada) on Tuesday, October 20, 2026 is scheduled.",
    );
    expect(e.text).toContain("Event\n30 Minute Meeting");
    expect(e.text).toContain("Event Date/Time\n10:00am - Tuesday, October 20, 2026 (Eastern Time - US & Canada)");
    expect(e.text).toContain(`Location\nThis is a Google Meet web conference.\nJoin now (${ctx.join_url})`);
    expect(e.text).toContain("Invitee Time Zone\nEastern Time - US & Canada");
    expect(e.text).toContain("Questions\nWhat would you like to discuss?\nRoadmap\nBudget");
    expect(e.text).toContain(`Need to make changes to this event?\nCancel: ${ctx.cancel_url}\nReschedule: ${ctx.reschedule_url}`);
    expect(e.text).toContain("Add to calendar\nGoogle: https://calendar.google.com/calendar/render?");
    expect(e.text).toContain("Apple / iCal: https://example.com/booking/x/event.ics");
    expect(e.text).toContain("Powered by Kairos");
    expect(e.text).toContain("You are receiving this email because you scheduled an event with Jordan Lee.");
    // HTML: the same content in the shared layout, links absolute and escaped.
    expect(e.html).toContain('href="https://example.com/cancellations/00000000-0000-4000-8000-000000000000"');
    expect(e.html).toContain(">Join now</a>");
    expect(e.html).toContain('src="https://cdn.example.com/a.png"');
    expect(e.html).toContain("max-width:600px");
  });

  it("guests get the confirmation without manage links or answers, greeted with Hi,", () => {
    const e = render({ kind: "guest_confirmation" });
    expect(e.text).toMatch(/^Hi,\n/);
    expect(e.text).not.toContain("Need to make changes");
    expect(e.text).not.toContain("What would you like to discuss?");
    expect(e.text).toContain("Sam Rivera added you as a guest to an event with Jordan Lee.");
  });

  it("host new event: Event Type, Invitee, email, guests, the invitee's zone and View event button", () => {
    const e = render({
      kind: "host_new_event",
      inviteeTimeZone: "Central European Time",
      meetingUrl: "https://example.com/app/meetings?event=1",
      notices: [{ tone: "warning", title: "Booked over", text: "This meeting overlaps Lunch on your calendar." }],
    });
    expect(e.subject).toBe("New Event: Sam Rivera - 10:00am Tuesday, October 20, 2026 - 30 Minute Meeting");
    expect(e.text).toContain("Hi Jordan Lee,\n\nA new event has been scheduled.");
    expect(e.text).toContain("Event Type\n30 Minute Meeting");
    expect(e.text).toContain("Invitee\nSam Rivera");
    expect(e.text).toContain("Invitee Email\nsam@example.com\n");
    // A mailto link whose text is the address is not repeated in the text version.
    expect(e.text).not.toContain("sam@example.com (sam@example.com)");
    expect(e.html).toContain('href="mailto:sam@example.com"');
    expect(e.text).toContain("Guests\nalex@example.com");
    expect(e.text).toContain("Invitee Time Zone\nCentral European Time");
    expect(e.text).toContain("Booked over\nThis meeting overlaps Lunch on your calendar.");
    expect(e.text).toContain("View event in Kairos: https://example.com/app/meetings?event=1");
    expect(e.text).not.toContain("Need to make changes");
    expect(e.text).toContain("You are receiving this email because you are a host of this event.");
    expect(e.html).toContain("border-radius:9999px");
  });

  it("cancellations: struck-through time, canceled by, reason and Schedule again; no manage links", () => {
    const e = render({ kind: "invitee_canceled", cancellation: { canceledBy: "Jordan Lee", reason: "Out sick" } });
    expect(e.subject).toBe("Canceled: 30 Minute Meeting with Jordan Lee on Tuesday, October 20, 2026");
    expect(e.text).toContain("Your 30 Minute Meeting with Jordan Lee at 10:00am on Tuesday, October 20, 2026 has been canceled.");
    expect(e.text).toContain("Canceled by\nJordan Lee");
    expect(e.text).toContain("Reason\nOut sick");
    expect(e.text).toContain(`Schedule again: ${ctx.event_type_url}`);
    expect(e.text).not.toContain("Need to make changes");
    expect(e.text).not.toContain("Location");
    expect(e.html).toContain("text-decoration:line-through");
    const host = render({ kind: "host_canceled", cancellation: { canceledBy: "Sam Rivera", reason: null } });
    expect(host.subject).toBe("Canceled: 30 Minute Meeting with Sam Rivera on Tuesday, October 20, 2026");
    expect(host.text).toContain("The event below has been canceled.");
    expect(host.text).not.toContain("Schedule again");
  });

  it("reschedules: new time, struck-through former time and the reason", () => {
    const former = { ...ctx, event_time: "9:00am", event_date: "Monday, October 19, 2026" };
    const e = render({ kind: "invitee_rescheduled", former: { ctx: former, reason: "Conflict" } });
    expect(e.subject).toBe("Updated: 30 Minute Meeting with Jordan Lee on Tuesday, October 20, 2026");
    expect(e.text).toContain("Event Date/Time\n10:00am - Tuesday, October 20, 2026 (Eastern Time - US & Canada)");
    expect(e.text).toContain("Former time\n9:00am - Monday, October 19, 2026 (Eastern Time - US & Canada)");
    expect(e.text).toContain("Reason for rescheduling\nConflict");
    expect(e.text).toContain("Need to make changes to this event?");
    expect(e.html).toMatch(/<s style="text-decoration:line-through[^>]*>9:00am - Monday, October 19, 2026/);
    expect(render({ kind: "host_rescheduled", former: { ctx: former } }).subject).toBe(
      "Rescheduled: Sam Rivera - 10:00am Tuesday, October 20, 2026 - 30 Minute Meeting",
    );
  });

  it("reminders: the NT-09 defaults, location and manage links", () => {
    const e = render({ kind: "invitee_reminder" });
    expect(e.subject).toBe("Reminder: 30 Minute Meeting with Jordan Lee at 10:00am Tuesday, October 20, 2026");
    expect(e.text).toContain("This is a friendly reminder that 30 Minute Meeting with Jordan Lee is at 10:00am on Tuesday, October 20, 2026.");
    expect(e.text).toContain("Join now");
    expect(e.text).toContain("Need to make changes to this event?");
    expect(e.text).not.toContain("Add to calendar");
    expect(render({ kind: "invitee_reminder", manageLinks: false }).text).not.toContain("Need to make changes");
    expect(render({ kind: "host_reminder" }).subject).toBe("Reminder: 30 Minute Meeting with Sam Rivera at 10:00am Tuesday, October 20, 2026");
  });

  it("custom subject and body templates replace the defaults; variable values are escaped; links still appended", () => {
    const evil = { ...ctx, invitee_first_name: "<script>x</script>", event_name: "Plan & Review" };
    const e = renderMeetingEmail({
      kind: "invitee_reminder",
      ctx: evil,
      brand,
      subjectTemplate: "Heads up: {{event_name}} {{unknown_var}}",
      bodyTemplate: "<p>Hey {{invitee_first_name}}, <strong>{{event_name}}</strong> starts at {{event_time}}.</p>",
    });
    expect(e.subject).toBe("Heads up: Plan & Review");
    expect(e.html).toContain("Hey &lt;script&gt;x&lt;/script&gt;, <strong>Plan &amp; Review</strong> starts at 10:00am.");
    expect(e.html).not.toContain("<script>");
    expect(e.text).toContain("Hey <script>x</script>, Plan & Review starts at 10:00am.");
    expect(e.text).toContain("Need to make changes to this event?");
    // A plain text body keeps its line breaks.
    const plain = renderMeetingEmail({ kind: "invitee_reminder", ctx, brand, bodyTemplate: "Line one {{my_name}}\nLine two" });
    expect(plain.text).toContain("Line one Jordan Lee\nLine two");
  });

  it("conference not created yet, venues with notes, phone numbers and branding off", () => {
    const pending = render({ kind: "invitee_confirmation", location: { ...meet, joinUrl: null } });
    expect(pending.text).toContain("Location\nWeb conferencing details to follow.");
    const venue = render({
      kind: "invitee_confirmation",
      ctx: { ...ctx, location: "Blue Bottle Coffee, 66 Mint St, San Francisco", join_url: "" },
      location: { kind: "physical", location: "Blue Bottle Coffee, 66 Mint St, San Francisco", additionalInfo: "Table by the window", joinUrl: null },
      brand: { showPoweredBy: false },
    });
    expect(venue.text).toContain("Location\nBlue Bottle Coffee, 66 Mint St, San Francisco\nTable by the window");
    expect(venue.text).not.toContain("Powered by");
    expect(meetingDateTimeLine({ event_time: "14:00", event_date: "Dienstag, 20. Oktober 2026", event_time_zone: "Mitteleuropaeische Zeit" })).toBe(
      "14:00 - Dienstag, 20. Oktober 2026 (Mitteleuropaeische Zeit)",
    );
  });
});

describe("every meeting email kind (NT-05: valid HTML and text, snapshots)", () => {
  const kinds: MeetingEmailInput["kind"][] = [
    "invitee_confirmation",
    "guest_confirmation",
    "host_new_event",
    "invitee_canceled",
    "guest_canceled",
    "host_canceled",
    "invitee_rescheduled",
    "guest_rescheduled",
    "host_rescheduled",
    "invitee_reminder",
    "host_reminder",
  ];
  const balanced = (html: string, tag: string) =>
    (html.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length === (html.match(new RegExp(`</${tag}>`, "g")) ?? []).length;

  it.each(kinds)("%s", (kind) => {
    const e = render({
      kind,
      meetingUrl: "https://example.com/app/meetings?event=1",
      cancellation: { canceledBy: "Jordan Lee", reason: "Out sick" },
      former: { ctx: { ...ctx, event_time: "9:00am", event_date: "Monday, October 19, 2026" }, reason: "Conflict" },
    });
    expect(e.subject).not.toMatch(/[\r\n]|\{\{/);
    expect(e.html.startsWith("<!doctype html>")).toBe(true);
    for (const tag of ["html", "body", "table", "tr", "td", "p", "a", "div"]) expect(balanced(e.html, tag), tag).toBe(true);
    expect(e.html).not.toMatch(/\{\{|undefined|null</);
    expect(e.text).not.toMatch(/\{\{|undefined|<[a-z]/i);
    // No relative links: every href is absolute or mailto (NT-05).
    for (const [, href] of e.html.matchAll(/href="([^"]*)"/g)) expect(href).toMatch(/^(https?:\/\/|mailto:)/);
    expect(`Subject: ${e.subject}\n\n${e.text}`).toMatchSnapshot();
  });
});

describe("NT-01 acceptance with a real template context", () => {
  it("the invitee confirmation shows the time in the invitee's zone and format and carries the cancel URL", async () => {
    const host = await createUser(t.db, { name: "Jordan Lee", timezone: "America/New_York" });
    const { eventType } = await createEventType(t.db, { owner: host, name: "Coffee Chat" });
    const { scheduledEvent, invitee } = await createBooking(t.db, {
      eventType,
      start: "2026-10-20T12:00:00Z",
      invitee: { name: "Lena Vogel", email: "lena@example.com", timezone: "Europe/Berlin", overrides: { timeFormat: "24h" } },
    });
    const c = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, inviteeId: invitee!.id, recipient: "invitee", db: t.db });
    const e = renderMeetingEmail({ kind: "invitee_confirmation", ctx: c, brand: { showPoweredBy: true }, location: scheduledEvent.location });
    expect(e.subject).toBe("Confirmed: Coffee Chat with Jordan Lee on Tuesday, October 20, 2026");
    expect(e.text).toContain("at 14:00 (Central European Time) on Tuesday, October 20, 2026 is scheduled.");
    expect(e.text).toContain(`Cancel: http://localhost:3000/cancellations/${invitee!.id}`);
    expect(e.html).toContain(`http://localhost:3000/cancellations/${invitee!.id}`);
    // The host email: host zone times, the invitee's own zone in "Invitee Time Zone".
    const hostCtx = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, inviteeId: invitee!.id, recipient: "host", db: t.db });
    const hostEmail = renderMeetingEmail({ kind: "host_new_event", ctx: hostCtx, brand: { showPoweredBy: true } });
    expect(hostEmail.subject).toBe("New Event: Lena Vogel - 8:00am Tuesday, October 20, 2026 - Coffee Chat");
    expect(hostEmail.text).toContain("Event Date/Time\n8:00am - Tuesday, October 20, 2026 (Eastern Time - US & Canada)");
    expect(hostEmail.text).toContain("Invitee Time Zone\nCentral European Time");
  });
});
