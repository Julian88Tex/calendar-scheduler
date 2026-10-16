// Booking input validation (BK-09 to BK-13, GEN-06), location resolution (VID-01), request schemas (BK-31) and the
// BK-21 redirect URL.
import { describe, expect, it } from "vitest";
import type { LocationConfig } from "@/db/types";
import { buildRedirectUrl, isoInZone } from "./redirect";
import { bookingRequestSchema, slotsQuerySchema, verifyRequestSchema } from "./schemas";
import type { BookingTarget, CreateBookingInput, EventTypeRow } from "./types";
import { MESSAGES, normalizePhone, resolveLocation, validateBookingInput } from "./validate";

const meet: LocationConfig = { id: "11111111-1111-4111-8111-111111111111", kind: "google_conference", position: 0 };
const venue: LocationConfig = {
  id: "22222222-2222-4222-8222-222222222222",
  kind: "physical",
  position: 1,
  location: "Golden Gate Grill - Marina - $$$\n[Business Casual Dress Code]",
  additionalInfo: "2001 Chestnut Street",
};
const ask: LocationConfig = { id: "33333333-3333-4333-8333-333333333333", kind: "ask_invitee", position: 2, location: "Suggest a place" };
const call: LocationConfig = { id: "44444444-4444-4444-8444-444444444444", kind: "outbound_call", position: 3 };

function target(over: Partial<EventTypeRow> = {}): BookingTarget {
  return {
    kind: "event_type",
    eventType: {
      id: "00000000-0000-4000-8000-000000000001",
      type: "standard",
      kind: "solo",
      durationMinutes: 30,
      durationOptions: null,
      nameFormat: "full",
      allowGuests: true,
      collectMarketingConsent: false,
      timeZoneDisplay: "auto",
      lockedTimeZone: null,
      locale: "en",
      locations: [meet],
      questions: [
        {
          id: "q1",
          position: 0,
          label: "What would you like to discuss?",
          type: "text",
          required: true,
          enabled: true,
          answerChoices: [],
          includeOther: false,
        },
      ],
      ...over,
    } as unknown as EventTypeRow,
  };
}

const input = (over: Partial<CreateBookingInput> = {}): CreateBookingInput => ({
  target: { kind: "event_type", eventTypeId: "00000000-0000-4000-8000-000000000001" },
  start: "2026-10-14T17:00:00Z",
  invitee: { name: "Ana Lima", email: "Ana@Example.com", timezone: "America/New_York" },
  answers: [{ questionId: "q1", value: "Roadmap" }],
  ...over,
});

describe("validateBookingInput", () => {
  it("normalizes a valid booking (email stored as typed, matched lowercased)", () => {
    const r = validateBookingInput(input({ invitee: { name: " Ana Lima ", email: "Ana@Example.com", timezone: "America/New_York", detectedTimezone: "Europe/Berlin", timeFormat: "24h" } }), target());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      name: "Ana Lima",
      email: "Ana@Example.com",
      emailNormalized: "ana@example.com",
      timezone: "America/New_York",
      detectedTimezone: "Europe/Berlin",
      timeFormat: "24h",
      durationMinutes: 30,
      location: { config: meet, value: null },
    });
    expect(r.value.answers).toEqual([
      { questionId: "q1", question: "What would you like to discuss?", type: "text", position: 0, answer: "Roadmap" },
    ]);
  });

  it("reports blank name, email and required questions without losing other input (BK-09)", () => {
    const r = validateBookingInput(input({ invitee: { name: "", email: "", timezone: "UTC" }, answers: [] }), target());
    expect(r).toEqual({ ok: false, fieldErrors: { name: [MESSAGES.blank], email: [MESSAGES.blank], "answers.q1": [MESSAGES.blank] } });
    const bad = validateBookingInput(input({ invitee: { name: "A", email: "nope", timezone: "UTC" } }), target());
    expect(bad).toMatchObject({ ok: false, fieldErrors: { email: [MESSAGES.email] } });
  });

  it("hosts skip required questions (OO-13)", () => {
    expect(validateBookingInput(input({ answers: [] }), target(), { hostActor: true }).ok).toBe(true);
  });

  it("first and last name format requires both", () => {
    const r = validateBookingInput(input({ invitee: { firstName: "Ana", email: "a@example.com", timezone: "UTC" } }), target({ nameFormat: "first_last" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { lastName: [MESSAGES.blank] } });
    const ok = validateBookingInput(input({ invitee: { firstName: "Ana", lastName: "Lima", email: "a@example.com", timezone: "UTC" } }), target({ nameFormat: "first_last" }));
    expect(ok.ok && ok.value.name).toBe("Ana Lima");
  });

  it("caps guests at 10 unique emails, excluding the invitee (BK-10)", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `g${i}@example.com`);
    expect(validateBookingInput(input({ guests: eleven }), target())).toMatchObject({ ok: false, fieldErrors: { guests: [MESSAGES.tooManyGuests] } });
    const r = validateBookingInput(input({ guests: ["ana@example.com", "b@example.com", "B@example.com"] }), target());
    expect(r.ok && r.value.guests).toEqual([{ email: "b@example.com", emailNormalized: "b@example.com" }]);
    expect(validateBookingInput(input({ guests: ["b@example.com"] }), target({ allowGuests: false })).ok).toBe(false);
  });

  it("requires a location choice among several and the invitee's text or phone (BK-11, VID-03, VID-06)", () => {
    const t = target({ locations: [venue, ask, call] });
    expect(validateBookingInput(input(), t)).toMatchObject({ ok: false, fieldErrors: { location: [MESSAGES.location] } });
    expect(validateBookingInput(input({ locationAnswer: { configId: ask.id, value: " " } }), t)).toMatchObject({
      ok: false,
      fieldErrors: { "location.value": [MESSAGES.blank] },
    });
    expect(validateBookingInput(input({ locationAnswer: { configId: call.id, value: "12" } }), t)).toMatchObject({
      ok: false,
      fieldErrors: { "location.value": [MESSAGES.phone] },
    });
    const r = validateBookingInput(input({ locationAnswer: { configId: call.id, value: "+1 (415) 555-0123" } }), t);
    expect(r.ok && r.value.location).toEqual({ config: call, value: "+14155550123" });
    const v = validateBookingInput(input({ locationAnswer: { configId: venue.id } }), t);
    expect(v.ok && v.value.location.config).toEqual(venue);
  });

  it("validates radios, checkboxes, dropdowns and phone answers (BK-12)", () => {
    const t = target({
      questions: [
        { id: "r", position: 0, label: "Pick", type: "single_select", required: true, enabled: true, answerChoices: ["A", "B"], includeOther: false },
        { id: "c", position: 1, label: "Check", type: "multi_select", required: true, enabled: true, answerChoices: ["X", "Y"], includeOther: false },
        { id: "d", position: 2, label: "Drop", type: "dropdown", required: false, enabled: true, answerChoices: ["S"], includeOther: false },
        { id: "p", position: 3, label: "Phone", type: "phone_number", required: false, enabled: true, answerChoices: [], includeOther: false },
        { id: "off", position: 4, label: "Hidden", type: "text", required: true, enabled: false, answerChoices: [], includeOther: false },
      ] as unknown as EventTypeRow["questions"],
    });
    const empty = validateBookingInput(input({ answers: [] }), t);
    expect(empty).toEqual({ ok: false, fieldErrors: { "answers.r": [MESSAGES.radio], "answers.c": [MESSAGES.checkbox] } });
    const wrong = validateBookingInput(input({ answers: [{ questionId: "r", value: "Z" }, { questionId: "c", value: ["X"] }, { questionId: "d", value: "M" }, { questionId: "p", value: "abc" }] }), t);
    expect(wrong).toEqual({ ok: false, fieldErrors: { "answers.r": [MESSAGES.radio], "answers.d": [MESSAGES.radio], "answers.p": [MESSAGES.phone] } });
    const ok = validateBookingInput(input({ answers: [{ questionId: "r", value: "B" }, { questionId: "c", value: ["Y", "X"] }] }), t);
    expect(ok.ok && ok.value.answers.map((a) => a.answer)).toEqual(["B", "Y\nX"]);
  });

  it("stores the locked zone with the browser zone as detected (GEN-06)", () => {
    const r = validateBookingInput(
      input({ invitee: { name: "A", email: "a@example.com", timezone: "America/New_York", detectedTimezone: "America/New_York", timeFormat: "24h" } }),
      target({ timeZoneDisplay: "locked", lockedTimeZone: "Europe/Berlin" }),
    );
    expect(r.ok && { tz: r.value.timezone, detected: r.value.detectedTimezone, fmt: r.value.timeFormat }).toEqual({
      tz: "Europe/Berlin",
      detected: "America/New_York",
      fmt: "24h",
    });
  });

  it("rejects SMS numbers of unsupported countries (BK-13), invalid zones, times and durations", () => {
    const r = validateBookingInput(input({ invitee: { name: "A", email: "a@example.com", timezone: "Mars/Base", textReminderNumber: "+6591234567" }, start: "soon", durationMinutes: 45 }), target());
    expect(r).toMatchObject({
      ok: false,
      fieldErrors: { timezone: [MESSAGES.timezone], textReminderNumber: [MESSAGES.smsCountry], start: [MESSAGES.start], duration: [MESSAGES.duration] },
    });
  });
});

describe("resolveLocation (VID-01)", () => {
  it("keeps venue text with line breaks, takes invitee answers and queues conferencing", () => {
    expect(resolveLocation(venue, null)).toMatchObject({ kind: "physical", location: venue.location, additionalInfo: "2001 Chestnut Street", status: null });
    expect(resolveLocation(ask, "Blue Bottle")).toMatchObject({ kind: "ask_invitee", location: "Blue Bottle" });
    expect(resolveLocation(meet, null)).toMatchObject({ kind: "google_conference", status: "processing", joinUrl: null, configId: meet.id });
    expect(resolveLocation(null, null)).toMatchObject({ kind: null, configId: null });
  });

  it("normalizes phone numbers to E.164", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("0049 30 1234567")).toBe("+49301234567");
    expect(normalizePhone("555-0123")).toBeNull();
  });
});

describe("request schemas (BK-31)", () => {
  it("parses a slots query and rejects inverted ranges", () => {
    expect(slotsQuerySchema.safeParse({ target: "abc", start: "2026-10-01", end: "2026-10-31", tz: "America/New_York", duration: "30" }).success).toBe(true);
    expect(slotsQuerySchema.safeParse({ target: "abc", start: "2026-10-31", end: "2026-10-01", tz: "UTC" }).success).toBe(false);
    expect(slotsQuerySchema.safeParse({ target: "", start: "2026-10-01", end: "2026-10-02", tz: "UTC" }).success).toBe(false);
  });

  it("parses a booking body and strips unknown context such as reschedule and actor", () => {
    const parsed = bookingRequestSchema.parse({
      target: { kind: "event_type", eventTypeId: "00000000-0000-4000-8000-000000000001" },
      start: "2026-10-14T17:00:00Z",
      invitee: { name: "Ana", email: "ana@example.com", timezone: "UTC" },
      actor: { type: "host", userId: "x", overrideAvailability: true },
      reschedule: { inviteeId: "y" },
      website: "",
      formToken: "1.abc",
    });
    expect(parsed).not.toHaveProperty("actor");
    expect(parsed).not.toHaveProperty("reschedule");
    expect(verifyRequestSchema.parse({ code: " 123456 ", rememberDevice: true })).toEqual({ code: "123456", rememberDevice: true });
  });
});

describe("buildRedirectUrl (BK-21)", () => {
  it("appends event details URL-encoded in the invitee zone", () => {
    const url = buildRedirectUrl({
      url: "https://example.com/thanks?x=1",
      passDetails: true,
      eventTypeName: "30 Minute Virtual",
      eventTypeId: "et-1",
      start: new Date("2026-10-14T17:00:00Z"),
      end: new Date("2026-10-14T17:30:00Z"),
      zone: "America/New_York",
      guests: ["b@example.com"],
      assignedTo: "Julian Joseph",
      invitee: {
        id: "inv-1",
        email: "ana+test@example.com",
        name: "Ana Lima",
        firstName: null,
        lastName: null,
        textReminderNumber: null,
        utmSource: "news",
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
      },
      answers: ["Roadmap & pricing"],
      payment: null,
    })!;
    const u = new URL(url);
    expect(u.searchParams.get("x")).toBe("1");
    expect(u.searchParams.get("invitee_email")).toBe("ana+test@example.com");
    expect(url).toContain("invitee_email=ana%2Btest%40example.com");
    expect(u.searchParams.get("answer_1")).toBe("Roadmap & pricing");
    expect(u.searchParams.get("event_start_time")).toBe("2026-10-14T13:00:00-04:00");
    expect(u.searchParams.get("invitee_first_name")).toBe("Ana");
    expect(u.searchParams.get("invitee_last_name")).toBe("Lima");
    expect(u.searchParams.get("utm_source")).toBe("news");
  });

  it("returns the plain URL without details and refuses non-http URLs", () => {
    expect(buildRedirectUrl({ url: "https://example.com/a", passDetails: false })).toBe("https://example.com/a");
    expect(buildRedirectUrl({ url: "javascript:alert(1)", passDetails: false })).toBeUndefined();
    expect(isoInZone(new Date("2026-10-14T17:00:00Z"), "UTC")).toBe("2026-10-14T17:00:00Z");
  });
});
