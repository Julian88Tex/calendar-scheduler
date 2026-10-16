// Sanity checks for the shared fakes in tests/helpers/fake-providers.ts.
import { afterEach, describe, expect, it } from "vitest";
import { now } from "@/lib/time/now";
import {
  calendlyApiRoutes,
  createFakeStripe,
  fakeCalendarProvider,
  freezeTime,
  googleRoutes,
  microsoftRoutes,
  mockFetch,
  resetFakeProviders,
  twilioRoutes,
  zoomRoutes,
  type FakeSms,
} from "../helpers/fake-providers";

const ctx = { connectionId: "conn-1", userId: "user-1", provider: "google" as const, unavailableStatuses: [] };

describe("fake providers", () => {
  afterEach(() => resetFakeProviders());

  it("fake calendar provider lists, creates (idempotently) and deletes events", async () => {
    const p = fakeCalendarProvider("google");
    p.setEvents("conn-1", "primary", [{ start: new Date("2026-10-20T15:00:00Z"), end: new Date("2026-10-20T16:00:00Z") }]);
    const listed = await p.listEvents(ctx, ["primary"], { start: new Date("2026-10-20T00:00:00Z"), end: new Date("2026-10-21T00:00:00Z") });
    expect(listed.primary).toHaveLength(1);
    const input = {
      title: "Intro",
      descriptionText: "",
      start: new Date("2026-10-21T15:00:00Z"),
      end: new Date("2026-10-21T15:30:00Z"),
      attendees: [],
      sendInvitations: false,
      conference: "google_meet" as const,
      transparency: "busy" as const,
      icalUid: "uid-1",
      idempotencyKey: "idem-1",
      privateProperties: {},
    };
    const a = await p.createEvent(ctx, "primary", input);
    const b = await p.createEvent(ctx, "primary", input);
    expect(a.externalId).toBe(b.externalId);
    expect(a.conference?.joinUrl).toMatch(/^https:\/\//);
    await p.deleteEvent(ctx, "primary", a.externalId, { notifyAttendees: false });
    expect(await p.getEvent(ctx, "primary", a.externalId)).toBeNull();
    p.failNext = { kind: "auth", count: 1 };
    await expect(p.listCalendars(ctx)).rejects.toThrow(/invalid_grant/);
    expect(p.calls.map((c) => c.method)).toContain("createEvent");
  });

  it("mockFetch routes Google, Graph, Zoom, Twilio and Calendly calls and refuses unknown hosts", async () => {
    const sms: FakeSms[] = [];
    const f = mockFetch(...googleRoutes(), ...microsoftRoutes(), ...zoomRoutes(), ...twilioRoutes(sms), ...calendlyApiRoutes({ pageSize: 1, eventTypes: [{ uri: "a" }, { uri: "b" }] }));
    try {
      const token = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code" }) })).json();
      expect(token.access_token).toBeTruthy();
      const inserted = await (
        await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ summary: "x", conferenceData: {} }),
        })
      ).json();
      expect(inserted.hangoutLink).toContain("meet.google.com");
      expect((await (await fetch("https://graph.microsoft.com/v1.0/me")).json()).id).toBe("ms-oid-1");
      expect((await (await fetch("https://graph.microsoft.com/v1.0/me/calendars?$select=id")).json()).value).toHaveLength(1);
      const zoom = await (await fetch("https://api.zoom.us/v2/users/me/meetings", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
      expect(zoom.join_url).toContain("zoom.us/j/");
      const tw = await fetch("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: "+15551234567", From: "+15557654321", Body: "Reminder" }),
      });
      expect(tw.status).toBe(201);
      expect(sms[0].body).toBe("Reminder");
      const page1 = await (await fetch("https://api.calendly.com/event_types", { headers: { authorization: "Bearer x" } })).json();
      expect(page1.collection).toHaveLength(1);
      expect(page1.pagination.next_page_token).toBe("1");
      expect((await fetch("https://api.calendly.com/users/me")).status).toBe(401);
      await expect(fetch("https://evil.example.com/")).rejects.toThrow(/unexpected request/);
      expect(f.callsTo("www.googleapis.com/calendar", "POST")).toHaveLength(1);
      expect(f.callsTo("googleapis.com")).toHaveLength(2);
    } finally {
      f.restore();
    }
  });

  it("fake Stripe creates sessions and signs webhooks that constructEvent verifies", async () => {
    const stripe = createFakeStripe({ webhookSecret: "whsec_x" });
    const session = await stripe.checkout.sessions.create({ line_items: [{ price_data: { unit_amount: 5000, currency: "usd" } }] });
    expect(session.url).toContain("checkout.stripe.com");
    const { payload, header } = stripe.completeSession(session.id);
    const event = stripe.webhooks.constructEvent(payload, header, "whsec_x");
    expect(event.type).toBe("checkout.session.completed");
    expect(() => stripe.webhooks.constructEvent(payload, header, "whsec_other")).toThrow();
  });

  it("freezeTime freezes Date and therefore now()", () => {
    const clock = freezeTime("2026-03-08T06:59:00Z");
    try {
      expect(now().toISOString()).toBe("2026-03-08T06:59:00.000Z");
      clock.advance(60_000);
      expect(now().toISOString()).toBe("2026-03-08T07:00:00.000Z");
      clock.set("2027-01-01T00:00:00Z");
      expect(new Date().getUTCFullYear()).toBe(2027);
    } finally {
      clock.restore();
    }
    expect(Math.abs(Date.now() - new Date().getTime())).toBeLessThan(5);
  });
});
