// Server rendering of the Meetings page body from seeded data (SPEC MT-01, MT-05, MT-06, MT-07, MT-15): the counter,
// the tabs with Export and Filter, date headers and rows, the inline details of ?event= with every block, the
// Calendly empty states with "Share your link", and a viewer's details without Cancel or Reschedule.
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestUser } from "../factories";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }), usePathname: () => "/app/meetings" }));

const { eventTypePermissions, users } = await import("@/db/schema");
const { loadActorCtx } = await import("@/lib/authz");
const { parseMeetingsQuery } = await import("@/lib/meetings/filters");
const { loadMeetingsPage } = await import("@/lib/meetings/queries");
const { MeetingsView } = await import("@/components/meetings/meetings-view");
const { useTestDb } = await import("../helpers/db");
const f = await import("../factories");

const t = useTestDb();
const NOW = new Date("2030-10-07T13:00:00Z");
const H = 3_600_000;
let owner: TestUser;
let seq = 0;

beforeEach(async () => {
  owner = await f.createUser(t.db, { name: "Julian Joseph", timezone: "America/Los_Angeles", slug: `jj-render-${++seq}` });
});

async function html(u: TestUser, qs = ""): Promise<string> {
  const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
  const data = await loadMeetingsPage(await loadActorCtx(t.db, row!), parseMeetingsQuery(new URLSearchParams(qs)), { db: t.db, now: NOW });
  return renderToStaticMarkup(createElement(MeetingsView, { data }));
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("MeetingsView", () => {
  it("renders the counter, tabs, date header and rows", async () => {
    const { eventType } = await f.createEventType(t.db, { owner, name: "30 Minute Virtual" });
    await f.createBooking(t.db, { eventType, start: new Date(NOW.getTime() + 5 * H), invitee: { name: "Maya Patel" } });
    const out = text(await html(owner));
    expect(out).toContain("Displaying 1 - 1 of 1 Events");
    for (const s of ["Upcoming", "Past", "Date Range", "Export", "Filter", "Monday, October 7, 2030", "11:00am - 11:30am", "Maya Patel", "Event type 30 Minute Virtual", "1 host | 0 non-hosts", "Details"]) {
      expect(out).toContain(s);
    }
    expect(out).not.toContain("Reschedule");
  });

  it("expands ?event= inline with the details blocks and actions", async () => {
    const { eventType } = await f.createEventType(t.db, { owner, name: "30 Minute Virtual" });
    const b = await f.createBooking(t.db, {
      eventType,
      start: new Date(NOW.getTime() + 5 * H),
      invitee: {
        name: "Maya Patel",
        email: "maya.patel@example.com",
        questionsAndAnswers: [{ questionId: null, question: "What would you like to discuss?", type: "text", position: 0, answer: "Roadmap" }],
      },
    });
    const markup = await html(owner, `event=${b.scheduledEvent.id}`);
    const out = text(markup);
    expect(markup).toContain('aria-expanded="true"');
    for (const s of ["Reschedule", "Cancel", "Edit Event Type", "Filter by Event Type", "Email", "maya.patel@example.com", "Invitee time zone", "Eastern Time - US & Canada", "Questions", "What would you like to discuss?", "Roadmap", "Meeting host", "Add meeting notes", "Created"]) {
      expect(out).toContain(s);
    }
    expect(out).not.toContain("Schedule Invitee Again");
    // Server render: the inline panel is hidden below md by CSS, so phones (sheet after hydration) never flash it.
    expect(markup).toMatch(/data-testid="meeting-details-panel"/);
    expect(markup).toMatch(/class="[^"]*\bmax-md:hidden\b[^"]*"[^>]*data-testid="meeting-details-panel"/);
  });

  it("pages with Previous and Next (a disabled button on the first page)", async () => {
    const { eventType } = await f.createEventType(t.db, { owner, name: "30 Minute Virtual" });
    for (let i = 0; i < 26; i++) await f.createBooking(t.db, { eventType, start: new Date(NOW.getTime() + (i + 1) * H) });
    const markup = await html(owner);
    expect(text(markup)).toContain("Displaying 1 - 25 of 26 Events");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Previous/s);
    expect(markup).toMatch(/<a[^>]*rel="next"[^>]*href="\/app\/meetings\?after=[^"]+&amp;page=2"|<a[^>]*href="\/app\/meetings\?after=[^"]+&amp;page=2"[^>]*rel="next"/);
    expect(markup).not.toContain('aria-disabled="true"');
  });

  it("shows the Calendly empty states", async () => {
    expect(text(await html(owner))).toContain("No Upcoming Events");
    expect(text(await html(owner))).toContain("Share your link");
    expect(text(await html(owner, "tab=past"))).toContain("No Past Events");
    expect(text(await html(owner, "tab=range"))).toContain("No events in this date range");
    const filtered = text(await html(owner, "q=nobody"));
    expect(filtered).toContain("No meetings match your search or filters.");
    expect(filtered).toContain("Clear all filters");
  });

  it("gives viewers the details without Cancel or Reschedule", async () => {
    const { eventType } = await f.createEventType(t.db, { owner, name: "30 Minute Virtual" });
    const b = await f.createBooking(t.db, { eventType, start: new Date(NOW.getTime() + 5 * H) });
    const viewer = await f.createUser(t.db, { organizationId: owner.organizationId });
    await t.db.insert(eventTypePermissions).values({ eventTypeId: eventType.id, userId: viewer.id, level: "view" });
    const markup = await html(viewer, `event=${b.scheduledEvent.id}`);
    const out = text(markup);
    expect(out).toContain("You can view this meeting. Only its hosts can change it.");
    expect(out).not.toMatch(/\bReschedule\b/);
    expect(out).not.toContain("Add meeting notes");
    expect(markup).not.toMatch(/>\s*Cancel\s*</);
    // The owner's markup has the button, so the check above is meaningful.
    expect(await html(owner, `event=${b.scheduledEvent.id}`)).toMatch(/>\s*Cancel\s*</);
  });
});
