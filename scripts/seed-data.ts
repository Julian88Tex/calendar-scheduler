// Seed data (SPEC ADM-10, docs/research/owner-reference.md and calendly-account-observations.md). Pure data: no
// database access here; scripts/seed.ts and the E2E seed route turn it into rows. Location ids are fixed uuids so
// re-seeding is idempotent (invitee location choices reference them). Never embed the owner's photo.
import type { LocationConfig, MinuteRange, WeeklyHours } from "../src/db/types.ts";

/** Minutes from local midnight for "HH:MM". */
export const t = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const r = (from: string, to: string): MinuteRange => ({ start: t(from), end: t(to) });

export const SEED_PASSWORD = "password123"; // local demo only (ADM-10)

export const OWNER = {
  name: "Julian Joseph",
  slug: "julianjoseph",
  email: "owner@example.com",
  password: SEED_PASSWORD,
  timezone: "America/Los_Angeles",
  timeFormat: "12h" as const,
  locale: "en",
  welcomeMessage: "Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.",
};

export type SeedScheduleKey = "working_hours" | "block_off_work";

/** Index 0 = Sunday (WeeklyHours). */
export const OWNER_SCHEDULES: { key: SeedScheduleKey; name: string; isDefault: boolean; timezone: string; weeklyHours: WeeklyHours }[] = [
  {
    key: "working_hours",
    name: "Working hours",
    isDefault: true,
    timezone: "America/Los_Angeles",
    weeklyHours: [
      [r("14:00", "19:00")], // Sun
      [r("12:00", "17:00")], // Mon
      [r("11:00", "23:00")], // Tue
      [r("11:00", "23:00")], // Wed
      [r("11:00", "20:00")], // Thu
      [r("11:00", "17:00")], // Fri
      [], // Sat unavailable
    ],
  },
  {
    key: "block_off_work",
    name: "Block Off Work",
    isDefault: false,
    timezone: "America/Los_Angeles",
    weeklyHours: [
      [r("13:00", "21:00")], // Sun
      [r("17:00", "17:00")], // Mon: zero-length interval as observed (no availability)
      [r("17:00", "20:00")], // Tue
      [r("17:00", "20:00")], // Wed
      [r("17:00", "20:00")], // Thu
      [r("17:00", "17:00")], // Fri: zero-length interval as observed (no availability)
      [], // Sat none
    ],
  },
];

/** The one required question every owner event type has ("Multiple lines" is the `text` question type). */
export const DISCUSS_QUESTION = { label: "What would you like to discuss?", type: "text" as const, required: true };

const googleMeet = (id: string): LocationConfig => ({ id, kind: "google_conference", position: 0 });

/** 8 generic in-person venues ("Venue - Neighborhood - $$", street address in additional info) plus ask invitee. */
export const MEAL_LOCATIONS: LocationConfig[] = [
  { name: "Corner Bakery Cafe - Downtown - $", address: "101 Market Street, San Francisco, CA 94105" },
  { name: "Harbor Bistro - Waterfront - $$", address: "250 Embarcadero, San Francisco, CA 94111" },
  { name: "Green Leaf Kitchen - Mission - $$", address: "3100 Mission Street, San Francisco, CA 94110" },
  { name: "Golden Gate Grill - Marina - $$$\n[Business Casual Dress Code]", address: "2001 Chestnut Street, San Francisco, CA 94123" },
  { name: "Sunrise Coffee House - Noe Valley - $", address: "4001 24th Street, San Francisco, CA 94114" },
  { name: "Lantern Noodle Bar - Richmond - $$", address: "5500 Geary Boulevard, San Francisco, CA 94121" },
  { name: "Olive and Vine Trattoria - North Beach - $$$", address: "600 Columbus Avenue, San Francisco, CA 94133" },
  { name: "Riverside Tea Room - SoMa - $", address: "850 Folsom Street, San Francisco, CA 94107" },
]
  .map(
    (v, i): LocationConfig => ({
      id: `5eed0000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`,
      kind: "physical",
      position: i,
      location: v.name,
      additionalInfo: v.address,
      displayBeforeBooking: true,
    }),
  )
  .concat([
    {
      id: "5eed0000-0000-4000-8000-000000000009",
      kind: "ask_invitee",
      position: 8,
      location: "Suggest a place that works for you",
    },
  ]);

export type SeedEventType = {
  name: string;
  slug: string;
  durationMinutes: number;
  color: string;
  position: number;
  schedule: SeedScheduleKey;
  slotIncrementMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  locations: LocationConfig[];
  questions: (typeof DISCUSS_QUESTION)[];
};

export const OWNER_EVENT_TYPES: SeedEventType[] = [
  {
    name: "30 Minute Virtual",
    slug: "30min",
    durationMinutes: 30,
    color: "#8247f5",
    position: 0,
    schedule: "working_hours",
    slotIncrementMinutes: 15,
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 15,
    locations: [googleMeet("5eed0000-0000-4000-8000-000000000101")],
    questions: [DISCUSS_QUESTION],
  },
  {
    name: "60 Minute Virtual",
    slug: "60min",
    durationMinutes: 60,
    color: "#8247f5",
    position: 1,
    schedule: "working_hours",
    slotIncrementMinutes: 15,
    bufferBeforeMinutes: 15, // our choice (ADM-10)
    bufferAfterMinutes: 15,
    locations: [googleMeet("5eed0000-0000-4000-8000-000000000102")],
    questions: [DISCUSS_QUESTION],
  },
  {
    name: "In-Person Meal or Coffee",
    slug: "meal",
    durationMinutes: 120,
    color: "#17e885",
    position: 2,
    schedule: "block_off_work",
    slotIncrementMinutes: 15,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    locations: MEAL_LOCATIONS,
    questions: [DISCUSS_QUESTION],
  },
];

/** --demo extras: two contacts and a few meetings in the next two weeks (relative days, wall times in the owner zone). */
export const DEMO_CONTACTS = [
  {
    name: "Maya Patel",
    email: "maya.patel@example.com",
    company: "Northwind Labs",
    jobTitle: "Product Manager",
    timezone: "America/New_York",
  },
  {
    name: "Daniel Okafor",
    email: "daniel.okafor@example.com",
    company: "Bluebird Studio",
    jobTitle: "Founder",
    timezone: "America/Chicago",
  },
];

export type DemoMeeting = {
  /** Stable key stored in scheduled_events.metadata.seed (re-seeding moves the meeting instead of duplicating it). */
  key: string;
  eventTypeSlug: string;
  /** First candidate day (owner zone); the seed moves forward to the first day whose schedule fits the meeting. */
  daysFromNow: number;
  /** Wall time "HH:MM" in the owner zone. */
  time: string;
  invitee: { name: string; email: string; timezone: string };
  answer: string;
  /** Index into the event type's locations (the invitee's choice). */
  locationIndex: number;
};

export const DEMO_MEETINGS: DemoMeeting[] = [
  {
    key: "demo-meeting-1",
    eventTypeSlug: "30min",
    daysFromNow: 2,
    time: "11:00",
    invitee: { name: "Maya Patel", email: "maya.patel@example.com", timezone: "America/New_York" },
    answer: "Roadmap review for the Q4 launch.",
    locationIndex: 0,
  },
  {
    key: "demo-meeting-2",
    eventTypeSlug: "60min",
    daysFromNow: 5,
    time: "13:00",
    invitee: { name: "Daniel Okafor", email: "daniel.okafor@example.com", timezone: "America/Chicago" },
    answer: "Partnership ideas and next steps.",
    locationIndex: 0,
  },
  {
    key: "demo-meeting-3",
    eventTypeSlug: "meal",
    daysFromNow: 9,
    time: "17:30",
    invitee: { name: "Maya Patel", email: "maya.patel@example.com", timezone: "America/New_York" },
    answer: "Catching up over coffee.",
    locationIndex: 4,
  },
];

/** The "team" scenario used by tests: the owner plus 2 members, team "Sales" with a round robin and a collective type. */
export type SeedMember = {
  name: string;
  slug: string;
  email: string;
  password: string;
  timezone: string;
  /** Organization role (in the owner's organization). */
  role: "admin" | "user";
  /** Team role in "Sales" (admins manage the team, TM-05). */
  teamRole: "manager" | "member";
};

export type SeedTeamEventType = {
  name: string;
  slug: string;
  durationMinutes: number;
  poolingType: "round_robin" | "collective";
  color: string;
  position: number;
  locations: LocationConfig[];
};

export const TEAM_SCENARIO: {
  members: SeedMember[];
  team: { name: string; slug: string; timezone: string; welcomeMessage: string };
  eventTypes: SeedTeamEventType[];
} = {
  members: [
    {
      name: "Taylor Morgan",
      slug: "taylormorgan",
      email: "member1@example.com",
      password: SEED_PASSWORD,
      timezone: "America/New_York",
      role: "admin",
      teamRole: "manager",
    },
    {
      name: "Jordan Lee",
      slug: "jordanlee",
      email: "member2@example.com",
      password: SEED_PASSWORD,
      timezone: "America/Chicago",
      role: "user",
      teamRole: "member",
    },
  ],
  team: {
    name: "Sales",
    slug: "sales",
    timezone: "America/Los_Angeles",
    welcomeMessage: "Book time with our sales team.",
  },
  eventTypes: [
    {
      name: "Sales Intro",
      slug: "intro",
      durationMinutes: 30,
      poolingType: "round_robin",
      color: "#0069ff",
      position: 0,
      locations: [{ id: "5eed0000-0000-4000-8000-000000000201", kind: "jitsi_conference", position: 0 }],
    },
    {
      name: "Team Demo",
      slug: "demo",
      durationMinutes: 45,
      poolingType: "collective",
      color: "#ff8c00",
      position: 1,
      locations: [{ id: "5eed0000-0000-4000-8000-000000000202", kind: "jitsi_conference", position: 0 }],
    },
  ],
};
