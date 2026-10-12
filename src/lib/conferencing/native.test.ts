// Folding calendar results into the meeting location (SPEC VID-07, VID-12, VID-14): pushed with the join URL, initiated
// while Meet is pending, processing again after a transient calendar error, failed without a Google destination.
import { describe, expect, it, vi } from "vitest";
import type { ResolvedLocation } from "@/db/types";

vi.mock("@/lib/calendars", () => ({ getDestinationCalendar: vi.fn(), refreshLinkedConference: vi.fn() }));

const { applyCalendarConference, applyLinkedEventConference, conferenceLocationBase } = await import("./native");

const queued = (over: Partial<ResolvedLocation> = {}): ResolvedLocation => ({
  configId: "cfg-1",
  kind: "google_conference",
  location: null,
  additionalInfo: "Bring the agenda",
  joinUrl: null,
  status: "processing",
  providerMeetingId: null,
  password: null,
  dialIn: null,
  data: { provider: "google_meet", calendarId: "cal-1" },
  error: null,
  ...over,
});

const meetData = { provider: "google_meet", conferenceId: "abc-defg-hij", statusCode: "success", entryPoints: [{ type: "video", uri: "https://meet.google.com/abc-defg-hij", label: "meet.google.com/abc-defg-hij" }] };

describe("applyLinkedEventConference", () => {
  it("stores the Meet link of a synced event", () => {
    const loc = applyLinkedEventConference(queued(), {
      status: "synced",
      linkedEventId: "le-1",
      externalId: "ev-1",
      conference: { status: "pushed", joinUrl: "https://meet.google.com/abc-defg-hij", data: meetData },
    });
    expect(loc).toMatchObject({
      configId: "cfg-1",
      additionalInfo: "Bring the agenda",
      status: "pushed",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      location: "https://meet.google.com/abc-defg-hij",
      providerMeetingId: "abc-defg-hij",
      error: null,
    });
    expect(loc.data).toMatchObject({ provider: "google_meet", calendarId: "cal-1", linkedEventId: "le-1", conferenceId: "abc-defg-hij", statusCode: "success" });
  });

  it("marks a pending Meet as initiated and keeps the linked event for the refresh", () => {
    const loc = applyLinkedEventConference(queued(), {
      status: "synced",
      linkedEventId: "le-1",
      externalId: "ev-1",
      conference: { status: "processing", joinUrl: null, data: { ...meetData, statusCode: "pending", entryPoints: [] } },
    });
    expect(loc).toMatchObject({ status: "initiated", joinUrl: null, error: null });
    expect(loc.data).toMatchObject({ linkedEventId: "le-1", statusCode: "pending" });
  });

  it("stays queued after a transient calendar error and fails without a Google destination", () => {
    expect(applyLinkedEventConference(queued(), { status: "pending", linkedEventId: "le-1", externalId: null })).toMatchObject({ status: "processing" });
    expect(applyLinkedEventConference(queued(), { status: "skipped_no_calendar", linkedEventId: "", externalId: null })).toMatchObject({
      status: "failed",
      error: "meet_requires_google_calendar",
      joinUrl: null,
    });
    expect(applyLinkedEventConference(queued(), { status: "failed", linkedEventId: "le-1", externalId: null })).toMatchObject({ status: "failed", error: "calendar_write_failed" });
  });

  it("fails when Google refuses to create the conference or returns none", () => {
    const refused = applyLinkedEventConference(queued(), {
      status: "synced",
      linkedEventId: "le-1",
      externalId: "ev-1",
      conference: { status: "failed", joinUrl: null, data: { ...meetData, statusCode: "failure" } },
    });
    expect(refused).toMatchObject({ status: "failed", error: "conference_not_created" });
    expect(applyLinkedEventConference(queued(), { status: "synced", linkedEventId: "le-1", externalId: "ev-1" })).toMatchObject({ status: "failed", error: "conference_not_created" });
  });

  it("keeps an existing link when an update answers without conference data or fails (VID-14)", () => {
    const pushed = queued({ status: "pushed", joinUrl: "https://meet.google.com/abc-defg-hij" });
    expect(applyLinkedEventConference(pushed, { status: "synced", linkedEventId: "le-1", externalId: "ev-1" })).toMatchObject({ status: "pushed", joinUrl: "https://meet.google.com/abc-defg-hij" });
    expect(applyLinkedEventConference(pushed, { status: "failed", linkedEventId: "le-1", externalId: "ev-1" })).toBe(pushed);
    expect(applyLinkedEventConference(pushed, { status: "pending", linkedEventId: "le-1", externalId: "ev-1" })).toMatchObject({ status: "pushed" });
  });

  it("never drops a link the invitee already has for a write that yields no new one (review regression)", () => {
    const pushed = queued({ status: "pushed", joinUrl: "https://meet.google.com/abc-defg-hij", location: "https://meet.google.com/abc-defg-hij" });
    // The destination calendar was disconnected since: the Meet stays on the Google event that holds it.
    expect(applyLinkedEventConference(pushed, { status: "skipped_no_calendar", linkedEventId: "le-1", externalId: "ev-1" })).toMatchObject({
      status: "pushed",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      error: null,
    });
    // An update answering with a pending, refused or unsafe conference keeps the existing link.
    for (const conference of [
      { status: "processing" as const, joinUrl: null },
      { status: "failed" as const, joinUrl: null },
      { status: "pushed" as const, joinUrl: "http://meet.google.com/insecure" },
    ]) {
      const loc = applyLinkedEventConference(pushed, { status: "synced", linkedEventId: "le-1", externalId: "ev-1", conference });
      expect(loc).toMatchObject({ status: "pushed", joinUrl: "https://meet.google.com/abc-defg-hij", location: "https://meet.google.com/abc-defg-hij" });
      expect(loc.data).toMatchObject({ linkedEventId: "le-1" });
    }
    // A new link from the provider replaces the old one.
    const moved = applyLinkedEventConference(pushed, {
      status: "synced",
      linkedEventId: "le-1",
      externalId: "ev-1",
      conference: { status: "pushed", joinUrl: "https://meet.google.com/new-link-xyz", data: { conferenceId: "new-link-xyz" } },
    });
    expect(moved).toMatchObject({ status: "pushed", joinUrl: "https://meet.google.com/new-link-xyz", providerMeetingId: "new-link-xyz" });
  });

  it("leaves other locations alone and refuses unsafe URLs", () => {
    const physical: ResolvedLocation = { ...queued(), kind: "physical", status: null, location: "Blue Bottle" };
    expect(applyLinkedEventConference(physical, { status: "skipped_no_calendar", linkedEventId: "", externalId: null })).toBe(physical);
    const jitsi: ResolvedLocation = { ...queued(), kind: "jitsi_conference", status: "pushed", joinUrl: "https://meet.jit.si/x" };
    expect(applyLinkedEventConference(jitsi, { status: "skipped_no_calendar", linkedEventId: "", externalId: null })).toBe(jitsi);
    expect(applyCalendarConference(queued(), { status: "pushed", joinUrl: "javascript:alert(1)" })).toMatchObject({ status: "failed", joinUrl: null });
  });

  it("builds a blank conference location that keeps the choice and notes", () => {
    expect(conferenceLocationBase("google_conference", queued({ status: "pushed", joinUrl: "https://meet.google.com/x" }))).toEqual({
      configId: "cfg-1",
      kind: "google_conference",
      location: null,
      additionalInfo: "Bring the agenda",
      joinUrl: null,
      status: null,
      providerMeetingId: null,
      password: null,
      dialIn: null,
      data: null,
      error: null,
    });
  });
});
