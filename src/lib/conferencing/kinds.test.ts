// Conferencing kinds and display rules (SPEC VID-07, VID-11, VID-12, VID-16).
import { describe, expect, it } from "vitest";
import type { ResolvedLocation } from "@/db/types";
import {
  CONFERENCE_KINDS,
  CONFERENCING_COPY,
  calendarConferenceFor,
  conferenceErrorMessage,
  conferenceJoinUrl,
  conferenceLocationText,
  conferenceMode,
  conferenceProviderName,
  isConferenceKind,
  isConferencePending,
  isSafeJoinUrl,
} from "./kinds";

const meet = (over: Partial<ResolvedLocation> = {}): ResolvedLocation => ({
  configId: "c1",
  kind: "google_conference",
  location: null,
  additionalInfo: null,
  joinUrl: null,
  status: "processing",
  providerMeetingId: null,
  password: null,
  dialIn: null,
  data: null,
  error: null,
  ...over,
});

describe("conference kinds", () => {
  it("classifies modes and calendar conferences", () => {
    expect(conferenceMode("google_conference")).toBe("calendar_native");
    expect(conferenceMode("microsoft_teams_conference")).toBe("calendar_native");
    expect(conferenceMode("zoom_conference")).toBe("standalone");
    expect(conferenceMode("jitsi_conference")).toBe("standalone");
    expect(conferenceMode("physical")).toBe("none");
    expect(conferenceMode("ask_invitee")).toBe("none");
    expect(calendarConferenceFor("google_conference")).toBe("google_meet");
    expect(calendarConferenceFor("microsoft_teams_conference")).toBe("microsoft_teams");
    expect(calendarConferenceFor("zoom_conference")).toBeNull();
    expect(calendarConferenceFor(null)).toBeNull();
    expect(CONFERENCE_KINDS.every((k) => isConferenceKind(k))).toBe(true);
    expect(isConferenceKind("physical")).toBe(false);
    expect(isConferenceKind(42)).toBe(false);
  });

  it("names providers like Calendly", () => {
    expect(conferenceProviderName("google_conference")).toBe("Google Meet");
    expect(conferenceProviderName("jitsi_conference")).toBe("Jitsi Meet");
    expect(conferenceProviderName("physical")).toBeNull();
  });

  it("accepts only absolute https join URLs without credentials", () => {
    expect(isSafeJoinUrl("https://meet.google.com/abc-defg-hij")).toBe(true);
    expect(isSafeJoinUrl("http://meet.google.com/abc-defg-hij")).toBe(false);
    expect(isSafeJoinUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeJoinUrl("https://user:pass@meet.google.com/x")).toBe(false);
    expect(isSafeJoinUrl("/relative")).toBe(false);
    expect(isSafeJoinUrl(`https://meet.google.com/${"a".repeat(2100)}`)).toBe(false);
    expect(isSafeJoinUrl(null)).toBe(false);
    // Review regression: the URL parser drops tabs and newlines, but the raw value goes into the Location header.
    expect(isSafeJoinUrl("https://meet.google.com/abc\r\nSet-Cookie: sid=x")).toBe(false);
    expect(isSafeJoinUrl("https://meet.google.com/a\tbc")).toBe(false);
    expect(isSafeJoinUrl("https://meet.google.com/a bc")).toBe(false);
    expect(isSafeJoinUrl("https://meet.google.com/abc\u2028")).toBe(false);
    expect(conferenceJoinUrl({ joinUrl: " https://meet.google.com/abc " })).toBe("https://meet.google.com/abc");
    expect(conferenceJoinUrl({ joinUrl: "ftp://x" })).toBeNull();
  });

  it("knows when a link is still being prepared", () => {
    expect(isConferencePending(meet())).toBe(true);
    expect(isConferencePending(meet({ status: "initiated" }))).toBe(true);
    expect(isConferencePending(meet({ status: "pushed", joinUrl: "https://meet.google.com/abc" }))).toBe(false);
    expect(isConferencePending(meet({ status: "failed" }))).toBe(false);
    expect(isConferencePending(null)).toBe(false);
  });

  it("shows the confirmation promise before booking and the join link after", () => {
    expect(conferenceLocationText(meet(), { booked: false })).toEqual({ provider: "Google Meet", text: "Web conferencing details provided upon confirmation.", href: null });
    expect(conferenceLocationText(meet(), { booked: true })).toEqual({ provider: "Google Meet", text: "Web conferencing details to follow.", href: null });
    expect(conferenceLocationText(meet({ status: "failed" }), { booked: true })?.text).toBe(CONFERENCING_COPY.toFollow);
    const pushed = meet({ status: "pushed", joinUrl: "https://meet.google.com/abc-defg-hij" });
    expect(conferenceLocationText(pushed, { booked: true })).toEqual({ provider: "Google Meet", text: "https://meet.google.com/abc-defg-hij", href: "https://meet.google.com/abc-defg-hij" });
    expect(conferenceLocationText(pushed, { booked: true, stableJoinUrl: "https://kairos.example.com/events/1/join" })?.href).toBe("https://kairos.example.com/events/1/join");
    expect(conferenceLocationText({ kind: "physical", joinUrl: null, status: null }, { booked: true })).toBeNull();
  });

  it("explains failures to the host", () => {
    expect(conferenceErrorMessage("meet_requires_google_calendar", "google_conference")).toBe(
      "You must configure your calendar connections to push events to a Google Calendar to host Google Meet web conferences on your events.",
    );
    expect(conferenceErrorMessage("calendar_write_failed", "google_conference")).toContain("no Google Meet link");
    expect(conferenceErrorMessage("conference_not_created", "google_conference")).toBe("Your calendar didn't create a Google Meet link for this meeting.");
    expect(conferenceErrorMessage("not_configured", "zoom_conference")).toBe("Zoom isn't available on this server.");
    expect(conferenceErrorMessage(null, "google_conference")).toBe("We couldn't create a Google Meet link for this meeting.");
  });
});
