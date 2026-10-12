// GET /events/{id}/join on PGlite (SPEC VID-11): 302 to the stored join URL, the preparing page while processing (5
// second refresh, up to 2 minutes), 404 with "This meeting was canceled." for canceled meetings, old links of
// rescheduled meetings following the reschedule (the redirect target updates), location details for other
// locations, 404 for unknown and malformed ids, never cached, no scripts.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const { scheduledEvents } = await import("@/db/schema");
const { GET } = await import("@/app/events/[id]/join/route");
const { createBooking, createEventType, createUser } = await import("../factories");
const { useTestDb } = await import("../helpers/db");
type ResolvedLocation = import("@/db/types").ResolvedLocation;

const t = useTestDb();

const loc = (over: Partial<ResolvedLocation> = {}): ResolvedLocation => ({
  configId: "11111111-1111-4111-8111-111111111111",
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

const pushed = (url: string) => loc({ status: "pushed", joinUrl: url, location: url });

async function meeting(location: ResolvedLocation, opts: { status?: "active" | "canceled"; rescheduledFrom?: string; name?: string } = {}) {
  const owner = await createUser(t.db);
  const { eventType } = await createEventType(t.db, { owner, name: opts.name ?? "30 Minute Virtual" });
  const { scheduledEvent } = await createBooking(t.db, {
    eventType,
    start: new Date(Date.now() + 2 * 86_400_000),
    location,
    status: opts.status,
    overrides: opts.rescheduledFrom ? { rescheduledFromEventId: opts.rescheduledFrom } : {},
  });
  return scheduledEvent;
}

const join = (id: string, qs = "") => GET(new Request(`http://localhost:3000/events/${id}/join${qs}`), { params: Promise.resolve({ id }) });

describe("GET /events/{id}/join", () => {
  it("redirects (302) to the provider join URL, uncached", async () => {
    const se = await meeting(pushed("https://meet.google.com/abc-defg-hij"));
    const r = await join(se.id);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://meet.google.com/abc-defg-hij");
    expect(r.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("shows the preparing page while processing, refreshing every 5 seconds for up to 2 minutes", async () => {
    const se = await meeting(loc());
    const r = await join(se.id);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    // Review regression: this page's own policy must not drop the frame-ancestors rule of /events.
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await r.text();
    expect(html).toContain("Your meeting link is being prepared. This page will refresh automatically.");
    expect(html).toContain(`content="5;url=/events/${se.id}/join?attempt=1"`);
    expect(html).toContain("30 Minute Virtual");
    expect(html).not.toContain("<script");

    const later = await (await join(se.id, "?attempt=7")).text();
    expect(later).toContain(`attempt=8`);
    const done = await join(se.id, "?attempt=24");
    const doneHtml = await done.text();
    expect(done.status).toBe(200);
    expect(doneHtml).not.toContain('http-equiv="refresh"');
    expect(doneHtml).toContain("Your meeting link isn't ready yet.");
    expect(await (await join(se.id, "?attempt=abc")).text()).toContain("attempt=1");
  });

  it("follows the link once the conference is pushed (the redirect target updates)", async () => {
    const se = await meeting(loc({ status: "initiated" }));
    expect((await join(se.id)).status).toBe(200);
    await t.db.update(scheduledEvents).set({ location: pushed("https://meet.google.com/new-link-abc") }).where(eq(scheduledEvents.id, se.id));
    const r = await join(se.id);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://meet.google.com/new-link-abc");
  });

  it("answers 404 with the canceled message for canceled meetings", async () => {
    const se = await meeting(pushed("https://meet.google.com/abc-defg-hij"), { status: "canceled" });
    const r = await join(se.id);
    expect(r.status).toBe(404);
    const html = await r.text();
    expect(html).toContain("This meeting was canceled.");
    expect(html).not.toContain("meet.google.com");
  });

  it("follows reschedules from an old link to the current meeting's link", async () => {
    const first = await meeting(pushed("https://meet.google.com/old-link-aaa"), { status: "canceled" });
    const second = await meeting(pushed("https://meet.google.com/mid-link-bbb"), { status: "canceled", rescheduledFrom: first.id });
    await meeting(pushed("https://meet.google.com/new-link-ccc"), { rescheduledFrom: second.id });
    const r = await join(first.id);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://meet.google.com/new-link-ccc");
    // A reschedule that was canceled too ends on the canceled page.
    const a = await meeting(pushed("https://meet.google.com/a"), { status: "canceled" });
    await meeting(pushed("https://meet.google.com/b"), { status: "canceled", rescheduledFrom: a.id });
    expect((await join(a.id)).status).toBe(404);
  });

  it("shows 'Web conferencing details to follow.' when the link could not be created", async () => {
    const se = await meeting(loc({ status: "failed", error: "meet_requires_google_calendar" }));
    const r = await join(se.id);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Web conferencing details to follow.");
  });

  it("shows the location details of other locations", async () => {
    const se = await meeting(loc({ kind: "physical", status: null, location: "Blue Bottle Coffee", additionalInfo: "315 Linden St, San Francisco" }), { name: "In-Person Meal or Coffee" });
    const r = await join(se.id);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("In-Person Meal or Coffee");
    expect(html).toContain("In-person meeting");
    expect(html).toContain("Blue Bottle Coffee");
    expect(html).toContain("315 Linden St, San Francisco");
  });

  it("escapes stored values", async () => {
    const se = await meeting(loc({ kind: "custom", status: null, location: '<script>alert("x")</script>' }), { name: '<b onclick="x">Hi</b>' });
    const html = await (await join(se.id)).text();
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<b onclick");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never puts a stored URL with line breaks into the Location header (review regression)", async () => {
    const se = await meeting(pushed("https://meet.google.com/abc-defg-hij\r\nSet-Cookie: sid=stolen"));
    const r = await join(se.id);
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(await r.text()).toContain("Web conferencing details to follow.");
  });

  it("answers 404 for unknown and malformed ids", async () => {
    const unknown = await join("00000000-0000-4000-8000-000000000000");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("Meeting not found");
    expect((await join("not-a-meeting")).status).toBe(404);
    expect((await join("'; drop table scheduled_events; --")).status).toBe(404);
  });
});
