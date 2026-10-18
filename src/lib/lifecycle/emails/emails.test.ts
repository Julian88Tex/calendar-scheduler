// Snapshot tests of the lifecycle emails (SPEC NT-01 to NT-05, CR-08, CAL-12, VID-12): every template renders valid HTML
// and a matching plain text part, copy falls back to English for locales without translations, and the times shown
// are the ones of the recipient's context (zone and time format applied by buildMeetingTemplateContext).
import { describe, expect, it } from "vitest";
import type { TemplateContext } from "@/lib/template";
import { bookingEmail, calendarFallbackEmail, conferenceFailureEmail, lifecycleNotices, requestRescheduleEmail } from "./index";

const brand = { showPoweredBy: true, avatarUrl: "http://localhost:3000/api/files/avatar-1" };

/** An invitee context in Berlin with 24 hour times. */
const inviteeCtx: TemplateContext = {
  event_name: "30 Minute Virtual",
  event_date: "Tuesday, October 20, 2026",
  event_time: "19:00",
  event_end_time: "19:30",
  event_time_zone: "Central European Time",
  location: "https://meet.google.com/abc-defg-hij",
  join_url: "http://localhost:3000/events/11111111-1111-4111-8111-111111111111/join",
  my_name: "Julian Joseph",
  host_name: "Julian Joseph",
  host_email: "julian@example.com",
  invitees_count: 1,
  event_type_url: "http://localhost:3000/julian/30min",
  invitee_full_name: "Ana Lima",
  invitee_first_name: "Ana",
  invitee_last_name: "Lima",
  invitee_email: "ana@example.com",
  invitee_time_zone: "Central European Time",
  questions_and_answers: "What would you like to discuss?\nThe roadmap",
  guests: "bo@example.com",
  cancel_url: "http://localhost:3000/cancellations/22222222-2222-4222-8222-222222222222",
  reschedule_url: "http://localhost:3000/reschedulings/22222222-2222-4222-8222-222222222222",
};
/** The host's context of the same meeting (Los Angeles, 12 hour times). */
const hostCtx: TemplateContext = { ...inviteeCtx, event_time: "10:00am", event_end_time: "10:30am", event_time_zone: "Pacific Time - US & Canada" };
const formerInvitee: TemplateContext = { ...inviteeCtx, event_date: "Monday, October 19, 2026", event_time: "18:00" };
const formerHost: TemplateContext = { ...hostCtx, event_date: "Monday, October 19, 2026", event_time: "9:00am" };
const meet = { kind: "google_conference" as const, location: null, additionalInfo: null, joinUrl: "https://meet.google.com/abc-defg-hij" };
const questions = [{ question: "What would you like to discuss?", answer: "The roadmap" }];

function wellFormed(email: { subject: string; html: string; text: string }) {
  expect(email.subject).not.toMatch(/[\r\n]/);
  expect(email.html.startsWith("<!DOCTYPE html") || email.html.startsWith("<!doctype html")).toBe(true);
  expect(email.html).toContain("</html>");
  expect(email.text.length).toBeGreaterThan(40);
  expect(email.html + email.text + email.subject).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`)); // GEN-11
}

describe("standard booking emails", () => {
  it("invitee confirmation in the invitee's zone and 24 hour format, with manage and calendar links", () => {
    const email = bookingEmail("invitee_confirmation", {
      ctx: inviteeCtx,
      brand,
      locale: "en",
      location: meet,
      questions,
      manageLinks: true,
      addToCalendar: [{ id: "google", label: "Google", url: "https://calendar.google.com/calendar/render?action=TEMPLATE" }],
    });
    wellFormed(email);
    expect(email.subject).toBe("Confirmed: 30 Minute Virtual with Julian Joseph on Tuesday, October 20, 2026");
    expect(email.text).toContain("Hi Ana,");
    expect(email.text).toContain("Your 30 Minute Virtual with Julian Joseph at 19:00 (Central European Time) on Tuesday, October 20, 2026 is scheduled.");
    expect(email.text).toContain("19:00 - Tuesday, October 20, 2026 (Central European Time)");
    expect(email.text).toContain("/cancellations/22222222-2222-4222-8222-222222222222");
    expect(email.text).toContain("This is a Google Meet web conference.");
    expect(email.text).toMatchSnapshot();
    expect(email.html).toMatchSnapshot();
  });

  it("guest confirmation greets with Hi, and never carries manage links", () => {
    const email = bookingEmail("guest_confirmation", { ctx: { ...inviteeCtx, invitee_first_name: "" }, brand, locale: "en", location: meet, manageLinks: true });
    wellFormed(email);
    expect(email.text).toContain("Hi,");
    expect(email.text).not.toContain("/cancellations/");
    expect(email.text).toMatchSnapshot();
  });

  it("host new event with spots, poll and booked-over notices in the host's zone", () => {
    const email = bookingEmail("host_new_event", {
      ctx: hostCtx,
      brand,
      locale: "en",
      location: meet,
      questions,
      meetingUrl: "http://localhost:3000/app/meetings?event=1",
      facts: { spots: { filled: 2, limit: 5 }, pollTitle: "Quarterly planning", overlaps: [{ title: "Team sync", time: "10:00am" }, { title: null, time: "10:15am" }] },
    });
    wellFormed(email);
    expect(email.subject).toBe("New Event: Ana Lima - 10:00am Tuesday, October 20, 2026 - 30 Minute Virtual");
    expect(email.text).toContain("2 of 5 spots filled");
    expect(email.text).toContain("Booked from meeting poll: Quarterly planning");
    expect(email.text).toContain("This meeting overlaps with Team sync at 10:00am.");
    expect(email.text).toContain("This meeting overlaps with another event at 10:15am.");
    expect(email.text).toContain("View event in Kairos");
    expect(email.text).toMatchSnapshot();
  });

  it("invitee cancellation with reason, canceler and Schedule again", () => {
    const email = bookingEmail("invitee_canceled", {
      ctx: inviteeCtx,
      brand,
      locale: "en",
      cancellation: { canceledBy: "Julian Joseph", reason: "Something came up" },
      manageLinks: true,
    });
    wellFormed(email);
    expect(email.subject).toBe("Canceled: 30 Minute Virtual with Julian Joseph on Tuesday, October 20, 2026");
    expect(email.text).toContain("Something came up");
    expect(email.text).toContain("Schedule again");
    expect(email.text).not.toContain("/cancellations/");
    expect(email.text).toMatchSnapshot();
  });

  it("host cancellation names the invitee", () => {
    const email = bookingEmail("host_canceled", { ctx: hostCtx, brand, locale: "en", cancellation: { canceledBy: "Ana Lima", reason: null }, meetingUrl: "http://localhost:3000/app/meetings?event=1" });
    wellFormed(email);
    expect(email.subject).toBe("Canceled: 30 Minute Virtual with Ana Lima on Tuesday, October 20, 2026");
    expect(email.text).toMatchSnapshot();
  });

  it("reschedule emails strike the former time (invitee and host zones)", () => {
    const invitee = bookingEmail("invitee_rescheduled", { ctx: inviteeCtx, brand, locale: "en", location: meet, former: { ctx: formerInvitee, reason: "Conflict" }, manageLinks: true });
    wellFormed(invitee);
    expect(invitee.subject).toBe("Updated: 30 Minute Virtual with Julian Joseph on Tuesday, October 20, 2026");
    expect(invitee.text).toContain("18:00 - Monday, October 19, 2026 (Central European Time)");
    expect(invitee.html).toContain("line-through");
    expect(invitee.text).toMatchSnapshot();
    const host = bookingEmail("host_rescheduled", { ctx: hostCtx, brand, locale: "en", location: meet, former: { ctx: formerHost, reason: null }, meetingUrl: "http://localhost:3000/app/meetings?event=1", facts: { fromCalendar: true } });
    wellFormed(host);
    expect(host.subject).toBe("Rescheduled: Ana Lima - 10:00am Tuesday, October 20, 2026 - 30 Minute Virtual");
    expect(host.text).toContain("9:00am - Monday, October 19, 2026 (Pacific Time - US & Canada)");
    expect(host.text).toContain("This change was made in your connected calendar.");
    expect(host.text).toMatchSnapshot();
  });
});

describe("lifecycle-only emails", () => {
  it("host emails use neutral grays so dark mode inversion keeps text gray, not blue (only links and buttons are blue)", () => {
    const host = bookingEmail("host_rescheduled", { ctx: hostCtx, brand, locale: "en", location: meet, former: { ctx: formerHost, reason: null }, meetingUrl: "http://localhost:3000/app/meetings?event=1", facts: { fromCalendar: true } });
    const blue = new Set(["#006BFF"]);
    const tinted = [...host.html.matchAll(/(?:color|background-color|bgcolor=")[:]?\s*(#[0-9A-Fa-f]{6})/g)]
      .map((m) => m[1].toUpperCase())
      .filter((hex) => !blue.has(hex))
      .filter((hex) => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return Math.max(r, g, b) - Math.min(r, g, b) > 8;
      });
    expect(tinted).toEqual([]);
    expect(host.html).not.toMatch(/class="k-card"[^>]*border:1px/);
  });

  it("request reschedule and its reminder", () => {
    const email = requestRescheduleEmail({ ctx: inviteeCtx, brand, locale: "en", message: "Could we move this to next week?", rebookUrl: String(inviteeCtx.reschedule_url) });
    wellFormed(email);
    expect(email.subject).toBe("Julian Joseph would like to reschedule");
    expect(email.text).toContain("Pick a new time: http://localhost:3000/reschedulings/22222222-2222-4222-8222-222222222222");
    expect(email.text).toContain("Could we move this to next week?");
    expect(email.html).toContain("line-through");
    expect(email.text).toMatchSnapshot();
    const reminder = requestRescheduleEmail({ ctx: inviteeCtx, brand, locale: "en", rebookUrl: String(inviteeCtx.reschedule_url), reminder: true });
    expect(reminder.subject).toBe("Reminder: Julian Joseph would like to reschedule");
    expect(reminder.text).not.toContain("Message from");
  });

  it("conference failure and calendar fallback notices for the host", () => {
    const failure = conferenceFailureEmail({ ctx: hostCtx, brand, provider: "Google Meet", problem: "Your calendar didn't create a Google Meet link for this meeting.", meetingUrl: "http://localhost:3000/app/meetings?event=1" });
    wellFormed(failure);
    expect(failure.subject).toBe("We couldn't create a Google Meet link for your meeting with Ana Lima");
    expect(failure.text).toMatchSnapshot();
    const fallback = calendarFallbackEmail({ ctx: hostCtx, brand: { showPoweredBy: false }, meetingUrl: "http://localhost:3000/app/meetings?event=1" });
    wellFormed(fallback);
    expect(fallback.subject).toBe("We emailed Ana Lima a confirmation for 30 Minute Virtual");
    expect(fallback.text).not.toContain("Powered by");
    expect(fallback.text).toMatchSnapshot();
  });
});

describe("locale fallback", () => {
  it("renders English copy for locales without translations and unknown locales", () => {
    for (const locale of ["fr", "de", "xx-YY", null]) {
      const email = requestRescheduleEmail({ ctx: inviteeCtx, brand, locale, rebookUrl: "http://localhost:3000/reschedulings/x" });
      expect(email.subject).toBe("Julian Joseph would like to reschedule");
      const confirm = bookingEmail("invitee_confirmation", { ctx: inviteeCtx, brand, locale, location: meet });
      expect(confirm.subject.startsWith("Confirmed: ")).toBe(true);
    }
    expect(lifecycleNotices({ spots: { filled: 1, limit: 3 } }, "es")[0]!.text).toBe("1 of 3 spots filled");
  });
});
