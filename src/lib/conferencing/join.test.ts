// Join link decisions and pages (SPEC VID-11): redirect, preparing with refresh (5 seconds, up to 2 minutes), canceled,
// conferencing details to follow, location details, not found; every value is escaped.
import { describe, expect, it } from "vitest";
import type { ResolvedLocation } from "@/db/types";
import { decideJoin, JOIN_MAX_ATTEMPTS, renderJoinPage, type JoinMeeting } from "./join";

const loc = (over: Partial<ResolvedLocation> = {}): ResolvedLocation => ({
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
const meeting = (location: ResolvedLocation | null, over: Partial<JoinMeeting> = {}): JoinMeeting => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "30 Minute Virtual",
  status: "active",
  location,
  ...over,
});
const opts = { appName: "Kairos", path: "/events/11111111-1111-4111-8111-111111111111/join" };

describe("decideJoin", () => {
  it("redirects to a pushed https link", () => {
    expect(decideJoin(meeting(loc({ status: "pushed", joinUrl: "https://meet.google.com/abc-defg-hij" })))).toEqual({ type: "redirect", url: "https://meet.google.com/abc-defg-hij" });
    expect(decideJoin(meeting(loc({ kind: "jitsi_conference", status: "pushed", joinUrl: "https://meet.jit.si/kairos-x" })))).toMatchObject({ type: "redirect" });
  });

  it("never redirects to an unsafe URL or a failed conference", () => {
    expect(decideJoin(meeting(loc({ status: "pushed", joinUrl: "javascript:alert(1)" })))).toMatchObject({ type: "no_link" });
    expect(decideJoin(meeting(loc({ status: "failed", joinUrl: "https://meet.google.com/old" })))).toMatchObject({ type: "no_link", provider: "Google Meet" });
    expect(decideJoin(meeting(loc({ kind: "custom", status: null, location: "https://evil.example/phish" })))).toMatchObject({ type: "details" });
  });

  it("prepares while processing or initiated, counting refreshes up to two minutes", () => {
    expect(decideJoin(meeting(loc()))).toMatchObject({ type: "preparing", nextAttempt: 1, provider: "Google Meet" });
    expect(decideJoin(meeting(loc({ status: "initiated" })), 5)).toMatchObject({ type: "preparing", nextAttempt: 6 });
    expect(decideJoin(meeting(loc()), JOIN_MAX_ATTEMPTS - 1)).toMatchObject({ type: "preparing", nextAttempt: JOIN_MAX_ATTEMPTS });
    expect(decideJoin(meeting(loc()), JOIN_MAX_ATTEMPTS)).toMatchObject({ type: "preparing_timeout" });
    expect(decideJoin(meeting(loc()), -3)).toMatchObject({ type: "preparing", nextAttempt: 1 });
    expect(decideJoin(meeting(loc()), Number.NaN)).toMatchObject({ type: "preparing", nextAttempt: 1 });
    expect(JOIN_MAX_ATTEMPTS * 5).toBe(120);
  });

  it("answers canceled, not found and location details", () => {
    expect(decideJoin(null)).toEqual({ type: "not_found" });
    expect(decideJoin(meeting(loc({ status: "pushed", joinUrl: "https://meet.google.com/x" }), { status: "canceled" }))).toEqual({ type: "canceled", meetingName: "30 Minute Virtual" });
    expect(decideJoin(meeting(loc({ kind: "physical", status: null, location: "Blue Bottle Coffee", additionalInfo: "315 Linden St" })))).toEqual({
      type: "details",
      meetingName: "30 Minute Virtual",
      heading: "In-person meeting",
      lines: [{ text: "Blue Bottle Coffee" }, { text: "315 Linden St", muted: true }],
    });
    expect(decideJoin(meeting(loc({ kind: "inbound_call", status: null, location: "+1 415 555 0100" })))).toMatchObject({
      type: "details",
      heading: "Phone call",
      lines: [{ text: "+1 415 555 0100", href: "tel:+14155550100" }],
    });
    expect(decideJoin(meeting(loc({ kind: "custom", status: null, location: "https://example.com/room" })))).toMatchObject({ lines: [{ text: "https://example.com/room", href: "https://example.com/room" }] });
    expect(decideJoin(meeting(null))).toMatchObject({ type: "details", lines: [{ text: "No location was set for this meeting.", muted: true }] });
    expect(decideJoin(meeting(loc({ kind: null, status: null })))).toMatchObject({ type: "details" });
  });
});

describe("renderJoinPage", () => {
  it("renders the preparing page with the exact copy and a 5 second refresh to the next attempt", () => {
    const page = renderJoinPage({ type: "preparing", meetingId: "x", meetingName: "30 Minute Virtual", provider: "Google Meet", nextAttempt: 3 }, opts);
    expect(page.status).toBe(200);
    expect(page.html).toContain("Your meeting link is being prepared. This page will refresh automatically.");
    expect(page.html).toContain(`<meta http-equiv="refresh" content="5;url=/events/11111111-1111-4111-8111-111111111111/join?attempt=3">`);
    expect(page.html).toContain('role="status"');
    expect(page.html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(page.html).not.toContain("<script");
  });

  it("stops refreshing after two minutes and offers Try again", () => {
    const page = renderJoinPage({ type: "preparing_timeout", meetingId: "x", meetingName: "30 Minute Virtual", provider: "Google Meet" }, opts);
    expect(page.html).not.toContain('http-equiv="refresh"');
    expect(page.html).toContain("Your meeting link isn't ready yet.");
    expect(page.html).toContain(`href="${opts.path}">Try again</a>`);
  });

  it("answers 404 for unknown and canceled meetings", () => {
    const missing = renderJoinPage({ type: "not_found" }, opts);
    expect(missing.status).toBe(404);
    expect(missing.html).toContain("Meeting not found");
    const canceled = renderJoinPage({ type: "canceled", meetingName: "30 Minute Virtual" }, opts);
    expect(canceled.status).toBe(404);
    expect(canceled.html).toContain("This meeting was canceled.");
  });

  it("renders details to follow and location details", () => {
    expect(renderJoinPage({ type: "no_link", meetingName: "60 Minute Virtual", provider: "Google Meet" }, opts).html).toContain("Web conferencing details to follow.");
    const details = renderJoinPage(
      { type: "details", meetingName: "Coffee", heading: "Phone call", lines: [{ text: "+1 415 555 0100", href: "tel:+14155550100" }, { text: "Call me", muted: true }] },
      opts,
    );
    expect(details.html).toContain('<a href="tel:+14155550100" rel="noopener noreferrer">+1 415 555 0100</a>');
    expect(details.html).toContain('<p class="muted">Call me</p>');
  });

  it("escapes meeting names, details and links", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const pages = [
      renderJoinPage({ type: "canceled", meetingName: evil }, opts),
      renderJoinPage({ type: "preparing", meetingId: "x", meetingName: evil, provider: "Google Meet", nextAttempt: 1 }, { ...opts, path: '/events/"x/join' }),
      renderJoinPage({ type: "details", meetingName: "M", heading: "Location", lines: [{ text: evil, href: 'https://x.example/"onmouseover="alert(1)' }] }, opts),
    ];
    for (const p of pages) {
      expect(p.html).not.toContain("<img");
      expect(p.html).not.toContain('"onmouseover=');
    }
    expect(pages[1]!.html).toContain("url=/events/&quot;x/join?attempt=1");
  });
});
