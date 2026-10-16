// Pure helpers of the booking pages: location display (VID-01 to VID-06, BK-11), host header variants (BK-03), URL state
// (BK-08), the details form model (BK-09 to BK-12, BK-19), slot helpers (BK-04, BK-33) and preview drafts (ET-29).
import { describe, expect, it } from "vitest";
import type { LocationConfig } from "@/db/types";
import {
  answersOf,
  buildBookingBody,
  emptyValues,
  guestError,
  interpretBookingResponse,
  showsLegalNotice,
  toE164,
  validateForm,
  type FormContext,
  type PublicQuestion,
} from "@/components/booking/lib/form";
import { headerName, hostHeader, hostNames, stackParts, type HostPerson } from "@/components/booking/lib/hosts";
import { locationInput, locationOption, locationRows, meetingLocation, toPublicLocations } from "@/components/booking/lib/locations";
import { availableDatesOf, conflictOf, monthRange, monthsBetween, nextMonthOf, slotsKey, slotsUrl } from "@/components/booking/lib/slots";
import { bt, interpolate } from "@/components/booking/lib/t";
import { calendarHref, carriedParams, detailsHref, landingForwardParams, parseDuration, startFromPath, startSegment, withCarried } from "@/components/booking/lib/url-state";
import { applyDraft, draftText } from "@/components/booking/use-preview-draft";
import type { EventView } from "@/components/booking/types";

const loc = (o: Partial<LocationConfig> & Pick<LocationConfig, "kind">): LocationConfig => ({ id: o.id ?? `${o.kind}-${o.position ?? 0}`, position: 0, ...o });

describe("locations", () => {
  it("strips hidden addresses, hidden custom texts and the inbound number before booking", () => {
    const list = toPublicLocations([
      loc({ kind: "physical", position: 2, location: "Cafe", additionalInfo: "1 Main St", displayBeforeBooking: false }),
      loc({ kind: "inbound_call", position: 1, phoneNumber: "+14155550123" }),
      loc({ kind: "custom", position: 0, location: "https://example.com/room" }),
      loc({ kind: "webex_conference", position: 3 }),
    ]);
    expect(list.map((l) => l.kind)).toEqual(["custom", "inbound_call", "physical"]);
    expect(list[0]!.text).toBeNull();
    expect(JSON.stringify(list)).not.toContain("+14155550123");
    expect(list[2]).toMatchObject({ text: null, additionalInfo: null });
  });

  it("shows one location's own text and no row for several (like Calendly)", () => {
    expect(locationRows(toPublicLocations([loc({ kind: "google_conference" })]))).toEqual([
      { key: "google_conference-0", icon: "video", text: "Web conferencing details provided upon confirmation.", detail: null },
    ]);
    expect(locationRows(toPublicLocations([loc({ kind: "inbound_call" })]))[0]!.text).toBe(
      "You will call the Host. Phone number will be provided upon booking completion.",
    );
    const one = locationRows(toPublicLocations([loc({ kind: "physical", location: "Golden Gate Grill\n[Business Casual Dress Code]", additionalInfo: "2001 Chestnut St" })]));
    expect(one[0]).toMatchObject({ icon: "pin", text: "Golden Gate Grill\n[Business Casual Dress Code]", detail: "2001 Chestnut St" });
    const meal = toPublicLocations([
      ...Array.from({ length: 8 }, (_, i) => loc({ id: `p${i}`, kind: "physical", position: i, location: `Venue ${i}` })),
      loc({ id: "ask", kind: "ask_invitee", position: 8, location: "Suggest a place" }),
    ]);
    expect(meal).toHaveLength(9);
    // Like Calendly (live capture): a multiple-location event lists no location in the left panel; the invitee sees
    // the options only as the "Location" radio list of the details form.
    expect(locationRows(meal)).toEqual([]);
    const mixed = toPublicLocations([
      loc({ id: "a", kind: "physical", position: 0, location: "Cafe A", displayBeforeBooking: false }),
      loc({ id: "g", kind: "google_conference", position: 1 }),
    ]);
    expect(locationRows(mixed)).toEqual([]);
    expect(locationRows([])).toEqual([]);
    expect(locationOption(meal[8]!).label).toBe("Somewhere else");
    expect(meal[8]!.prompt).toBe("Suggest a place");
    expect(locationInput(meal[8]!)).toBe("text");
    expect(locationInput(toPublicLocations([loc({ kind: "outbound_call" })])[0])).toBe("phone");
    expect(locationOption(toPublicLocations([loc({ kind: "zoom_conference" })])[0]!).label).toBe("Zoom");
  });

  it("describes the booked meeting's location for the confirmation page", () => {
    const base = { configId: null, location: null, additionalInfo: null, joinUrl: null, status: null, providerMeetingId: null, password: null, dialIn: null, data: null, error: null };
    expect(meetingLocation({ ...base, kind: "google_conference", status: "processing" }, { hostName: "Julian" })?.text).toBe("Web conferencing details to follow.");
    expect(meetingLocation({ ...base, kind: "google_conference", status: "pushed", joinUrl: "https://meet.google.com/abc" }, { hostName: "Julian" })).toMatchObject({
      text: "Google Meet",
      href: "https://meet.google.com/abc",
    });
    expect(meetingLocation({ ...base, kind: "outbound_call", location: "+14155550123" }, { hostName: "Julian" })?.text).toBe("Julian will call you at +14155550123");
    expect(meetingLocation({ ...base, kind: "physical", location: "Cafe", additionalInfo: "1 Main St" }, { hostName: "J" })).toMatchObject({ text: "Cafe", detail: "1 Main St" });
    expect(meetingLocation({ ...base, kind: "custom", location: "javascript:alert(1)" }, { hostName: "J" })?.href).toBeNull();
    expect(meetingLocation(null, { hostName: "J" })).toBeNull();
  });
});

describe("host header (BK-03)", () => {
  const people = (n: number): HostPerson[] => ["Ana", "Ben", "Cy", "Dee", "Eve"].slice(0, n).map((name, i) => ({ id: `u${i}`, name, avatarUrl: null }));
  const base = { scope: "shared" as const, owner: null, pooled: [] as HostPerson[], poolCount: 0, team: null };

  it("a 4-host collective shows 3 avatars, +1 and 'Ana and 3 others'", () => {
    const h = hostHeader({ ...base, poolingType: "collective", required: people(4) });
    expect(h.variant).toBe("stack");
    if (h.variant !== "stack") throw new Error("stack expected");
    expect(stackParts(h)).toEqual({ shown: people(3), more: 1 });
    expect(h.label).toBe("Ana and 3 others");
    expect(hostNames(people(2))).toBe("Ana, Ben");
  });

  it("round robin team events show the team; shared pools show avatars only; multi pool adds a circle per pool", () => {
    expect(hostHeader({ ...base, scope: "team", poolingType: "round_robin", required: [], pooled: people(3), team: { name: "Sales", avatarUrl: "/t.png" } })).toEqual({
      variant: "team",
      name: "Sales",
      avatarUrl: "/t.png",
    });
    const shared = hostHeader({ ...base, poolingType: "round_robin", required: [], pooled: people(5) });
    expect(shared).toMatchObject({ variant: "stack", label: null });
    if (shared.variant === "stack") expect(stackParts(shared).more).toBe(2);
    const multi = hostHeader({ ...base, poolingType: "multi_pool", required: people(2), pooled: people(5).slice(2), poolCount: 2 });
    if (multi.variant !== "stack") throw new Error("stack expected");
    expect(stackParts(multi)).toEqual({ shown: people(2), more: 2 });
    expect(headerName(multi)).toBe("Ana, Ben");
  });

  it("solo events show the owner", () => {
    const owner = people(1)[0]!;
    expect(hostHeader({ ...base, scope: "personal", poolingType: null, owner, required: [owner] })).toEqual({ variant: "single", person: owner });
  });
});

describe("URL state (BK-08)", () => {
  it("keeps prefill, UTM, display and embed parameters and manages month, date and duration", () => {
    const carry = carriedParams(new URLSearchParams("back=1&month=2026-10&date=2026-10-14&duration=60&name=Ana&utm_source=x&embed_type=Inline&slot_taken=1"));
    expect(carry).toEqual([
      ["back", "1"],
      ["name", "Ana"],
      ["utm_source", "x"],
      ["embed_type", "Inline"],
    ]);
    expect(calendarHref("/julianjoseph/30min", carry, { month: "2026-10", date: "2026-10-14", duration: 60, defaultDuration: 30 })).toBe(
      "/julianjoseph/30min?back=1&name=Ana&utm_source=x&embed_type=Inline&duration=60&month=2026-10&date=2026-10-14",
    );
    expect(detailsHref("/julianjoseph/30min", [], "2026-10-13T18:00:00.000Z", { month: "2026-10", date: "2026-10-13", duration: 30, defaultDuration: 30 })).toBe(
      "/julianjoseph/30min/2026-10-13T18:00:00Z?month=2026-10&date=2026-10-13",
    );
    expect(startSegment(new Date("2026-10-13T18:00:00.000Z"))).toBe("2026-10-13T18:00:00Z");
  });

  it("parses the start of a details path (Z and offset forms)", () => {
    expect(startFromPath("/julianjoseph/30min/2026-10-13T18:00:00Z", "/julianjoseph/30min")).toBe("2026-10-13T18:00:00.000Z");
    expect(startFromPath("/julianjoseph/30min/2026-10-13T11:00:00-07:00", "/julianjoseph/30min")).toBe("2026-10-13T18:00:00.000Z");
    expect(startFromPath("/julianjoseph/30min", "/julianjoseph/30min")).toBeNull();
    expect(startFromPath("/julianjoseph/30min/nope", "/julianjoseph/30min")).toBeNull();
  });

  it("forwards only prefill, tracking and display parameters from landing pages", () => {
    const fwd = landingForwardParams({ email: "a@b.co", a1: "Hi", back: "1", month: "2026-10", primary_color: "ff0000", foo: "bar" });
    expect(withCarried("/x/30min?back=1", fwd)).toBe("/x/30min?back=1&email=a%40b.co&a1=Hi&primary_color=ff0000");
    expect(parseDuration("60", [30, 60])).toBe(60);
    expect(parseDuration("45", [30, 60])).toBeNull();
  });
});

describe("details form", () => {
  it("shows the terms sentence only when a Terms of Use or Privacy Notice URL is configured", () => {
    expect(showsLegalNotice(null, null)).toBe(false);
    expect(showsLegalNotice("", "  ")).toBe(false);
    expect(showsLegalNotice("https://example.com/terms", null)).toBe(true);
    expect(showsLegalNotice(null, "https://example.com/privacy")).toBe(true);
  });

  const questions: PublicQuestion[] = [
    { id: "q1", label: "What would you like to discuss?", type: "text", required: true, answerChoices: [], includeOther: false, position: 0 },
    { id: "q2", label: "Topics", type: "multi_select", required: true, answerChoices: ["A", "B"], includeOther: true, position: 1 },
    { id: "q3", label: "Size", type: "single_select", required: true, answerChoices: ["S", "M"], includeOther: false, position: 2 },
    { id: "q4", label: "Phone", type: "phone_number", required: false, answerChoices: [], includeOther: false, position: 3 },
  ];
  const ctx: FormContext = {
    nameFormat: "full",
    allowGuests: true,
    locations: toPublicLocations([loc({ id: "l1", kind: "physical", location: "Cafe" }), loc({ id: "l2", kind: "outbound_call", position: 1 })]),
    questions,
  };

  it("shows the Calendly messages on the server's keys", () => {
    const v = emptyValues();
    expect(validateForm(v, ctx)).toEqual({
      name: "Can't be blank.",
      email: "Can't be blank.",
      location: "One location must be selected.",
      "answers.q1": "Can't be blank.",
      "answers.q2": "At least one answer must be checked.",
      "answers.q3": "One answer must be selected.",
    });
    const filled = { ...v, name: "Ana", email: "bad", locationId: "l2", phoneRaw: { location: "12" }, answers: { q1: "x", q3: "S", q4: "" }, otherSelected: { q2: true }, other: { q2: "" } };
    expect(validateForm(filled, ctx)).toEqual({
      email: "Enter a valid email address.",
      "location.value": "This phone number format is not recognized. Please check the country and number.",
      "answers.q2": "Can't be blank.",
    });
    expect(validateForm({ ...v, name: "", firstName: "", lastName: "" }, { ...ctx, nameFormat: "first_last" })).toMatchObject({ firstName: "Can't be blank.", lastName: "Can't be blank." });
  });

  it("limits guests to 10 valid addresses other than the invitee's", () => {
    expect(guestError(Array.from({ length: 11 }, (_, i) => `g${i}@example.com`), "a@example.com")).toBe("You can add up to 10 guests.");
    expect(guestError(["A@example.com"], "a@example.com")).toBe("This is already your email address.");
    expect(guestError(["nope"], "a@example.com")).toBe("Enter a valid email address.");
    expect(guestError(["b@example.com"], "a@example.com")).toBeNull();
  });

  it("builds the request body with Other answers, E.164 phones and the location answer", () => {
    const values = {
      ...emptyValues(),
      name: " Ana Lima ",
      email: "Ana@Example.com",
      guests: ["bo@example.com"],
      locationId: "l2",
      locationValue: "+1 (415) 555-0123",
      answers: { q1: "Hello", q2: ["A"], q3: "M", q4: "+14155550100" },
      otherSelected: { q2: true },
      other: { q2: "Something else" },
    };
    expect(answersOf(values, questions)).toEqual([
      { questionId: "q1", value: "Hello" },
      { questionId: "q2", value: ["A", "Something else"] },
      { questionId: "q3", value: "M" },
      { questionId: "q4", value: "+14155550100" },
    ]);
    const body = buildBookingBody({
      target: { kind: "event_type", eventTypeId: "et" },
      start: "2026-10-13T18:00:00.000Z",
      durationMinutes: 30,
      values,
      ctx,
      collectMarketing: false,
      timezone: "Asia/Kolkata",
      detectedTimezone: "Asia/Kolkata",
      timeFormat: "24h",
      locale: "en-US",
      tracking: { utmSource: "x" },
      clientRequestId: "req-12345678",
      formToken: "tok",
      honeypot: "",
      embed: false,
    });
    expect(body.invitee).toMatchObject({ name: "Ana Lima", email: "Ana@Example.com", timezone: "Asia/Kolkata", detectedTimezone: "Asia/Kolkata", timeFormat: "24h", marketingConsent: false });
    expect(body.locationAnswer).toEqual({ configId: "l2", value: "+14155550123" });
    expect(body.website).toBe("");
    expect("turnstileToken" in body).toBe(false);
    expect(toE164("0044 20 7946 0958")).toBe("+442079460958");
    // BK-18: the Turnstile token rides along when the instance requires one.
    const withToken = buildBookingBody({
      target: { kind: "event_type", eventTypeId: "et" },
      start: "2026-10-13T18:00:00.000Z",
      durationMinutes: 30,
      values,
      ctx,
      collectMarketing: false,
      timezone: "UTC",
      detectedTimezone: null,
      timeFormat: "12h",
      locale: "en-US",
      tracking: {},
      clientRequestId: "req-12345678",
      formToken: "tok",
      honeypot: "",
      turnstileToken: "cf-token",
      embed: false,
    });
    expect(withToken).toMatchObject({ turnstileToken: "cf-token", formToken: "tok" });
  });

  it("maps the endpoint's answers", () => {
    expect(interpretBookingResponse(200, { ok: true, inviteeId: "i", scheduledEventId: "s" })).toEqual({ type: "ok", inviteeId: "i", scheduledEventId: "s", redirectUrl: null });
    expect(interpretBookingResponse(202, { ok: false, code: "verification_required", reservationId: "r" })).toEqual({ type: "verify", reservationId: "r" });
    expect(interpretBookingResponse(409, { ok: false, code: "slot_unavailable" })).toEqual({ type: "slot_taken" });
    expect(interpretBookingResponse(409, { ok: false, code: "already_booked" })).toEqual({ type: "error", message: "You've already booked this time." });
    expect(interpretBookingResponse(400, { error: "validation", fieldErrors: { "invitee.email": ["Bad"] } })).toEqual({ type: "fields", fieldErrors: { email: "Bad" }, message: null });
    expect(interpretBookingResponse(429, { error: "rate_limited", message: "x" })).toEqual({ type: "error", message: bt("errors.rateLimited") });
    expect(interpretBookingResponse(500, { error: "internal", message: "stack" })).toEqual({ type: "error", message: bt("errors.generic") });
  });
});

describe("slots and copy", () => {
  it("builds month requests and marks conflicts", () => {
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(slotsUrl({ target: "et", month: "2026-10", zone: "America/New_York", duration: 30, first: true })).toBe(
      "/api/public/slots?target=et&start=2026-10-01&end=2026-10-31&tz=America%2FNew_York&duration=30&first=1",
    );
    expect(slotsKey({ target: "et", month: "2026-10", zone: "UTC", duration: 30, first: true })).toBe(slotsKey({ target: "et", month: "2026-10", zone: "UTC", duration: 30 }));
    expect(availableDatesOf({ timeZone: "UTC", durationMinutes: 30, windowEnd: null, days: { "2026-10-14": [{ start: "x", remaining: 1 }], "2026-10-15": [], "2026-11-01": [{ start: "y", remaining: 1 }] } }, "2026-10")).toEqual(["2026-10-14"]);
    const busy = [{ start: Date.parse("2026-10-14T18:00:00Z"), end: Date.parse("2026-10-14T18:30:00Z") }];
    expect(conflictOf("2026-10-14T17:45:00Z", 30, busy)).toBe(busy[0]);
    expect(conflictOf("2026-10-14T18:30:00Z", 30, busy)).toBeUndefined();
    expect(nextMonthOf("2026-12")).toBe("2027-01");
    expect(monthsBetween("2026-10", "2027-01")).toBe(3);
    expect(interpolate("{a} and {b}", { a: 1 })).toBe("1 and {b}");
    expect(bt("confirmation.withHost", { name: "Julian Joseph" })).toBe("You are scheduled with Julian Joseph.");
  });
});

describe("preview drafts (ET-29)", () => {
  const event: EventView = {
    id: "et",
    name: "Saved",
    color: "#8247f5",
    kind: "solo",
    durations: [30],
    defaultDuration: 30,
    descriptionHtml: "<p>Saved</p>",
    descriptionText: null,
    locations: [],
    questions: [],
    nameFormat: "full",
    allowGuests: true,
    collectMarketingConsent: false,
    autofill: false,
    showRemainingSpots: false,
    lockedTimeZone: null,
    active: true,
    secret: false,
    locale: "en",
  };

  it("applies the draft over the saved data and never injects markup", () => {
    const out = applyDraft(event, {
      name: "Draft name",
      color: "#17e885",
      durationMinutes: 45,
      durationOptions: [45, 60, 9999],
      locations: [loc({ kind: "physical", location: "Office" })],
      descriptionHtml: "<p>Hi <script>x</script><b>there</b></p>",
      priceMinor: null,
      currency: null,
      kind: "solo",
      maxInvitees: 1,
      showRemainingSpots: false,
      timeZoneDisplay: "locked",
      lockedTimeZone: "Europe/Berlin",
    });
    expect(out).toMatchObject({ name: "Draft name", durations: [45, 60], defaultDuration: 45, descriptionHtml: null, lockedTimeZone: "Europe/Berlin" });
    expect(out.descriptionText).toBe("Hi xthere");
    expect(out.locations[0]!.text).toBe("Office");
    expect(draftText("<p>a</p><p>b</p>")).toBe("a\nb");
    expect(applyDraft(event, null)).toBe(event);
  });

  it("survives drafts the editor sends mid-edit: a half typed zone, odd values (regression)", () => {
    const out = applyDraft(event, {
      name: "Draft",
      color: "#17e885",
      durationMinutes: 30,
      durationOptions: { 0: 45 } as unknown as number[],
      locations: [{ id: "x", kind: "physical", position: 0, location: 42 } as unknown as LocationConfig, null as unknown as LocationConfig],
      descriptionHtml: 7 as unknown as string,
      priceMinor: null,
      currency: null,
      kind: "solo",
      maxInvitees: 1,
      showRemainingSpots: false,
      timeZoneDisplay: "locked",
      lockedTimeZone: "Europe/Ber",
    });
    // An invalid zone would make every Intl call throw: the invitee's zone stays in use until the zone is valid.
    expect(out.lockedTimeZone).toBeNull();
    expect(out.durations).toEqual([30]);
    expect(out.descriptionText).toBeNull();
    expect(out.locations).toHaveLength(1);
    expect(out.locations[0]!.text).toBeNull();
  });
});
