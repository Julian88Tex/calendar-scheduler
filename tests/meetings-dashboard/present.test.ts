// Presentation rules of a meeting row (SPEC MT-02 date headers, MT-05 row labels, MT-06 LOCATION with "Join now" and
// the conferencing failure, CR-13 "Schedule Invitee Again"). Pure functions; the full row is covered by
// queries.test.ts on PGlite.
import { describe, expect, it } from "vitest";
import type { ResolvedLocation } from "@/db/types";
import { cancelerOf, dayHeading, hostsLabel, locationText, locationView, scheduleAgainHref } from "@/lib/meetings/present";

const LOC: ResolvedLocation = { configId: null, kind: null, location: null, additionalInfo: null, joinUrl: null, status: null, providerMeetingId: null, password: null, dialIn: null, data: null, error: null };
const ID = "33333333-3333-4333-8333-333333333333";
const open = { meetingId: ID, active: true, ended: false };

describe("dayHeading", () => {
  it("uses the viewer's zone and date format", () => {
    const at = new Date("2026-10-15T02:30:00Z"); // Oct 14, 7:30pm in Los Angeles
    expect(dayHeading(at, "America/Los_Angeles", "MM/DD/YYYY")).toBe("Wednesday, October 14, 2026");
    expect(dayHeading(at, "America/Los_Angeles", "DD/MM/YYYY")).toBe("Wednesday, 14 October 2026");
    expect(dayHeading(at, "Europe/Paris", "MM/DD/YYYY")).toBe("Thursday, October 15, 2026");
  });
});

describe("hostsLabel", () => {
  it("pluralizes hosts and non-hosts", () => {
    expect(hostsLabel(1, 0)).toBe("1 host | 0 non-hosts");
    expect(hostsLabel(2, 1)).toBe("2 hosts | 1 non-host");
  });
});

describe("locationView", () => {
  it("shows Google Meet with the stable join link while the meeting can be joined", () => {
    const meet = { ...LOC, kind: "google_conference" as const, status: "pushed" as const, joinUrl: "https://meet.google.com/abc-defg-hij" };
    expect(locationView(meet, open)).toEqual({ icon: "video", text: "Google Meet", detail: "https://meet.google.com/abc-defg-hij", href: null, joinHref: `/events/${ID}/join`, problem: null });
    expect(locationView(meet, { ...open, ended: true })?.joinHref).toBeNull();
    expect(locationView(meet, { ...open, active: false })?.joinHref).toBeNull();
  });

  it("explains a Meet link that could not be created", () => {
    const failed = { ...LOC, kind: "google_conference" as const, status: "failed" as const, error: "not_configured" };
    const v = locationView(failed, open);
    expect(v).toMatchObject({ text: "Google Meet", detail: "Web conferencing details to follow.", joinHref: null });
    expect(v?.problem).toBe("Google Meet isn't available on this server.");
    expect(locationView({ ...failed, error: "meet_requires_google_calendar" }, open)?.problem).toContain("push events to a Google Calendar");
  });

  it("says the link is on its way while Meet is still being created", () => {
    expect(locationView({ ...LOC, kind: "google_conference", status: "processing" }, open)).toMatchObject({ detail: "Web conferencing details to follow.", problem: null });
  });

  it("shows the venue and its address", () => {
    const venue = { ...LOC, kind: "physical" as const, location: "Sunrise Coffee House - Noe Valley - $", additionalInfo: "4001 24th Street, San Francisco, CA 94114" };
    expect(locationView(venue, open)).toMatchObject({ icon: "pin", text: "Sunrise Coffee House - Noe Valley - $", detail: "4001 24th Street, San Francisco, CA 94114" });
    expect(locationText(venue)).toBe("Sunrise Coffee House - Noe Valley - $, 4001 24th Street, San Francisco, CA 94114");
  });

  it("shows the invitee's own place and phone calls", () => {
    expect(locationView({ ...LOC, kind: "ask_invitee", location: "My office" }, open)).toMatchObject({ text: "My office" });
    expect(locationView({ ...LOC, kind: "outbound_call", location: "+1 415 555 0100" }, open)).toMatchObject({ icon: "phone", href: "tel:+14155550100", detail: "You will call your invitee." });
  });

  it("links custom URLs only when they are web links", () => {
    expect(locationView({ ...LOC, kind: "custom", location: "https://example.com/room" }, open)?.href).toBe("https://example.com/room");
    expect(locationView({ ...LOC, kind: "custom", location: "javascript:alert(1)" }, open)?.href).toBeNull();
  });

  it("has no block without a location", () => {
    expect(locationView(LOC, open)).toBeNull();
    expect(locationText(null)).toBe("");
  });
});

describe("cancelerOf", () => {
  const names = new Map([["u1", "Julian Joseph"]]);
  it("names hosts, invitees and automatic cancels", () => {
    expect(cancelerOf({ type: "host", userId: "u1", name: null }, null, names)).toEqual({ name: "Julian Joseph", role: "host" });
    expect(cancelerOf({ type: "invitee", userId: null, name: null }, { name: "Maya Patel" }, names)).toEqual({ name: "Maya Patel", role: "invitee" });
    expect(cancelerOf({ type: "system", userId: null, name: null }, null, names)).toEqual({ name: null, role: "automatic" });
    expect(cancelerOf({ type: "host", userId: null, name: "Ana" }, null, names).name).toBe("Ana");
  });
});

describe("scheduleAgainHref", () => {
  const et = { id: "e", name: "30 Minute Virtual", slug: "30min", active: true, deletedAt: null, type: "standard" as const, scope: "personal" as const, ownerUserId: "u1", ownerSlug: "julianjoseph" };
  it("opens the booking page prefilled with the invitee", () => {
    expect(scheduleAgainHref(et, { name: "Maya Patel", email: "maya@example.com" })).toBe("/julianjoseph/30min?name=Maya+Patel&email=maya%40example.com");
  });
  it("is absent for event types that can't be booked", () => {
    const p = { name: "Maya", email: "m@example.com" };
    expect(scheduleAgainHref({ ...et, active: false }, p)).toBeNull();
    expect(scheduleAgainHref({ ...et, deletedAt: new Date() }, p)).toBeNull();
    expect(scheduleAgainHref({ ...et, type: "adhoc" }, p)).toBeNull();
    expect(scheduleAgainHref({ ...et, ownerSlug: null }, p)).toBeNull();
    expect(scheduleAgainHref(null, p)).toBeNull();
  });
});
