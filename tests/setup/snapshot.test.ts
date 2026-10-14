// The owner's Calendly snapshot (src/lib/setup/owner-snapshot.ts) pinned to the owner decision and the research notes
// (docs/research/owner-reference.md, calendly-account-observations.md, calendly-live-capture.md). Part of it is reused
// from the demo seed data (scripts/seed-data.ts), so this test also guards production against demo data changes.
import { describe, expect, it } from "vitest";
import { OWNER_MEAL_LOCATIONS, OWNER_SNAPSHOT } from "@/lib/setup/owner-snapshot";
import { validateDraft } from "@/lib/event-types/schemas";
import { weeklyProblem } from "@/lib/availability/intervals";
import { BootstrapOwnerInputSchema } from "@/lib/setup/schemas";
import { bearerMatches, bootstrapSecrets, configuredOwnerEmail } from "@/lib/setup/config";

const { snapshotDraft } = await import("@/lib/setup/bootstrap");

const r = (from: string, to: string) => {
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  return { start: m(from), end: m(to) };
};

describe("owner snapshot", () => {
  it("holds the profile, without any email", () => {
    expect(OWNER_SNAPSHOT.profile).toEqual({
      name: "Julian Joseph",
      slug: "julianjoseph",
      timezone: "America/Los_Angeles",
      timeFormat: "12h",
      locale: "en",
      welcomeMessage: "Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.",
    });
    expect(JSON.stringify(OWNER_SNAPSHOT)).not.toMatch(/@/);
    expect(OWNER_SNAPSHOT.meetingLimits).toEqual({ perDay: null, perWeek: null });
  });

  it("holds both schedules with the observed hours (Calendly's 17:00 to 17:00 days as unavailable)", () => {
    expect(OWNER_SNAPSHOT.schedules).toEqual([
      {
        key: "working_hours",
        name: "Working hours",
        isDefault: true,
        timezone: "America/Los_Angeles",
        weeklyHours: [[r("14:00", "19:00")], [r("12:00", "17:00")], [r("11:00", "23:00")], [r("11:00", "23:00")], [r("11:00", "20:00")], [r("11:00", "17:00")], []],
      },
      {
        key: "block_off_work",
        name: "Block Off Work",
        isDefault: false,
        timezone: "America/Los_Angeles",
        weeklyHours: [[r("13:00", "21:00")], [], [r("17:00", "20:00")], [r("17:00", "20:00")], [r("17:00", "20:00")], [], []],
      },
    ]);
    for (const s of OWNER_SNAPSHOT.schedules) expect(weeklyProblem(s.weeklyHours)).toBeNull();
    expect(OWNER_SNAPSHOT.schedules.filter((s) => s.isDefault)).toHaveLength(1);
  });

  it("holds the three event types in profile order with the observed rules", () => {
    expect(OWNER_SNAPSHOT.eventTypes.map((e) => [e.name, e.slug, e.durationMinutes, e.color, e.schedule])).toEqual([
      ["30 Minute Virtual", "30min", 30, "#8247f5", "working_hours"],
      ["60 Minute Virtual", "60min", 60, "#8247f5", "working_hours"],
      ["In-Person Meal or Coffee", "meal", 120, "#17e885", "block_off_work"],
    ]);
    for (const e of OWNER_SNAPSHOT.eventTypes) {
      expect(e).toMatchObject({
        slotIncrementMinutes: 15,
        minimumNoticeMinutes: 240,
        dateRange: { type: "rolling", days: 60, mode: "calendar_days" },
        limitPerDay: null,
        limitPerWeek: null,
        limitPerMonth: null,
        allowGuests: true,
        autofillInvitee: true,
        questions: [{ label: "What would you like to discuss?", type: "text", required: true }],
        inviteeReminderOffsetsMinutes: [1440],
      });
    }
    const [thirty, sixty, meal] = OWNER_SNAPSHOT.eventTypes;
    expect([thirty!.bufferBeforeMinutes, thirty!.bufferAfterMinutes]).toEqual([15, 15]);
    expect([sixty!.bufferBeforeMinutes, sixty!.bufferAfterMinutes]).toEqual([15, 15]);
    expect([meal!.bufferBeforeMinutes, meal!.bufferAfterMinutes]).toEqual([0, 0]);
    expect(thirty!.locations).toEqual([{ kind: "google_conference" }]);
    expect(sixty!.locations).toEqual([{ kind: "google_conference" }]);
    expect(meal!.locations).toBe(OWNER_MEAL_LOCATIONS);
  });

  it("lists the eight venues in order, then Somewhere else", () => {
    expect(OWNER_MEAL_LOCATIONS).toEqual([
      { kind: "physical", location: "Tribute Pizza - North Park - $$$", address: "3077 N Park Way, San Diego, CA 92104" },
      { kind: "physical", location: "Best Pizza & Brew - Mira Mesa - $", address: "9172 Mira Mesa Blvd, San Diego, CA 92126" },
      { kind: "physical", location: "The Reading Club - Embarcadero - $$$\n[Business Casual Dress Code]", address: "901 Bayfront Court San Diego, CA 92101" },
      { kind: "physical", location: "Tavola Nostra - Hillcrest - $$", address: "1040 University Ave B101, San Diego, CA 92103" },
      { kind: "physical", location: "Bronx Pizza - Hillcrest - $", address: "111 Washington St, San Diego, CA 92103" },
      { kind: "physical", location: "Paradis Coffee - Mission Hills - $", address: "901 W Washington St, San Diego, CA 92103" },
      { kind: "physical", location: "Cardellino - Mission Hills - $$$", address: "4033 Goldfinch St, San Diego, CA 92103" },
      { kind: "physical", location: "Finjan Coffee - Convoy - $", address: "9119 Clairemont Mesa Blvd g, San Diego, CA 92123" },
      { kind: "ask_invitee" },
    ]);
  });

  it("produces editor drafts that pass the editor's own validation", () => {
    for (const e of OWNER_SNAPSHOT.eventTypes) {
      const draft = snapshotDraft(e, "00000000-0000-4000-8000-000000000001");
      const checked = validateDraft(draft, "solo");
      expect(checked.ok, JSON.stringify(checked)).toBe(true);
      expect(draft.locations.map((l) => l.position)).toEqual(e.locations.map((_, i) => i));
      expect(draft.durations).toEqual([e.durationMinutes]);
    }
  });
});

describe("bootstrap input and configuration", () => {
  it("parses the body", () => {
    expect(BootstrapOwnerInputSchema.parse({ email: " a@example.com " })).toEqual({ email: "a@example.com" });
    expect(BootstrapOwnerInputSchema.safeParse({ email: "a@example.com", avatarUrl: "https://user:pw@example.com/a.png" }).success).toBe(false);
    expect(BootstrapOwnerInputSchema.safeParse({ email: "a@example.com", avatarUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(BootstrapOwnerInputSchema.safeParse({ email: "a@example.com", name: "x".repeat(101) }).success).toBe(false);
    expect(BootstrapOwnerInputSchema.parse({ email: "a@example.com", name: null, avatarUrl: null })).toEqual({ email: "a@example.com", name: null, avatarUrl: null });
  });

  it("reads SETUP_TOKEN, CRON_SECRET and OWNER_EMAIL", () => {
    const token = "t".repeat(24);
    expect(bootstrapSecrets({ SETUP_TOKEN: ` ${token} `, CRON_SECRET: "c" })).toEqual([token, "c"]);
    expect(bootstrapSecrets({ SETUP_TOKEN: "", CRON_SECRET: "  " })).toEqual([]);
    expect(bearerMatches(`Bearer ${token}`, bootstrapSecrets({ SETUP_TOKEN: token }))).toBe(true);
    expect(configuredOwnerEmail({ OWNER_EMAIL: " Owner@Example.com " })).toBe("owner@example.com");
    expect(configuredOwnerEmail({ OWNER_EMAIL: "" })).toBeNull();
    expect(() => configuredOwnerEmail({ OWNER_EMAIL: "nope" })).toThrow(/OWNER_EMAIL/);
  });
});
