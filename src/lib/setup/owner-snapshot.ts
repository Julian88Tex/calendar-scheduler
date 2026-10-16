// The owner's Calendly setup as typed data (owner decision: production starts configured like their Calendly). Pure
// data, no I/O: src/lib/setup/bootstrap.ts turns it into rows through the domain services. The owner's email is NOT
// here: it comes from the bootstrap request (and must equal OWNER_EMAIL when that is set).
//
// Sources: docs/research/owner-reference.md, docs/research/calendly-account-observations.md and
// docs/research/calendly-live-capture.md. The demo seed (scripts/seed-data.ts) already holds the observed profile,
// schedules, durations, colors, increments and buffers; they are reused from there rather than copied, and
// tests/setup/snapshot.test.ts pins every value so a change to the demo data cannot silently change production.
// What the snapshot adds on top of the demo seed:
// - the owner's real in-person venues (the demo seed uses generic ones) and "Somewhere else" (ask invitee) last;
// - the rules the observations record: rolling 60 calendar days (`period_type` "moving", 86,400 minutes), guests
//   allowed, one combined Name field, autofill from earlier bookings (`booking_autofill`), the confirmation page with
//   "Schedule another event";
// - Calendly's defaults where the observations record nothing: minimum notice 4 hours, no daily or weekly limits, no
//   host meeting limits, and the default email reminder to invitees 24 hours before (docs/SCOPE.md priority 5).
// Days Calendly stores as a zero-length interval (Block Off Work: Monday and Friday 17:00 to 17:00) are stored as an
// empty day: both mean unavailable, and the availability editor refuses zero-length intervals on save.
import type { MinuteRange, WeeklyHours } from "@/db/types";
import { DISCUSS_QUESTION, OWNER, OWNER_EVENT_TYPES, OWNER_SCHEDULES, type SeedScheduleKey } from "../../../scripts/seed-data.ts";

/** Bumped when the snapshot changes meaningfully (stored with the applied marker on the account). */
export const OWNER_SNAPSHOT_VERSION = 1;

export type OwnerScheduleKey = SeedScheduleKey;

export type OwnerSnapshotProfile = {
  name: string;
  slug: string;
  timezone: string;
  timeFormat: "12h" | "24h";
  locale: "en";
  welcomeMessage: string;
};

export type OwnerSnapshotSchedule = {
  key: OwnerScheduleKey;
  name: string;
  isDefault: boolean;
  timezone: string;
  /** Index 0 = Sunday. */
  weeklyHours: WeeklyHours;
};

/** A location option of an event type, in the order the invitee sees them. */
export type OwnerSnapshotLocation =
  | { kind: "google_conference" }
  | {
      kind: "physical";
      /** Display text (Calendly `location`); may hold a newline and notes. */
      location: string;
      /** Street address (Calendly `additional_info`). */
      address: string;
    }
  /** "Somewhere else": the invitee types their own place. */
  | { kind: "ask_invitee" };

export type OwnerSnapshotQuestion = { label: string; type: "text"; required: boolean };

export type OwnerSnapshotEventType = {
  name: string;
  slug: string;
  durationMinutes: number;
  color: string;
  schedule: OwnerScheduleKey;
  locations: OwnerSnapshotLocation[];
  slotIncrementMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  dateRange: { type: "rolling"; days: number; mode: "calendar_days" };
  limitPerDay: number | null;
  limitPerWeek: number | null;
  limitPerMonth: number | null;
  allowGuests: boolean;
  /** Calendly `booking_autofill`: returning invitees get their name and email filled in. */
  autofillInvitee: boolean;
  questions: OwnerSnapshotQuestion[];
  /** Email reminders to the invitee, in minutes before the start (empty: none). */
  inviteeReminderOffsetsMinutes: number[];
};

export type OwnerSnapshot = {
  version: number;
  profile: OwnerSnapshotProfile;
  /** Host meeting limits across all event types (Availability > Meeting limits); null = no limit. */
  meetingLimits: { perDay: number | null; perWeek: number | null };
  schedules: OwnerSnapshotSchedule[];
  /** In profile page order (position 0, 1, 2). */
  eventTypes: OwnerSnapshotEventType[];
};

/** Calendly's default minimum notice (4 hours); the observations record no other value. */
const MINIMUM_NOTICE_MINUTES = 240;
/** Calendly `period_type` "moving" with `max_booking_time` 86,400 minutes: 60 calendar days. */
const ROLLING_DAYS = 60;
/** docs/SCOPE.md priority 5: the default email reminder to invitees, 24 hours before. */
const REMINDER_24H = 24 * 60;

/** The owner's eight venues in the order the meal event offers them, then "Somewhere else". */
export const OWNER_MEAL_LOCATIONS: OwnerSnapshotLocation[] = [
  { kind: "physical", location: "Tribute Pizza - North Park - $$$", address: "3077 N Park Way, San Diego, CA 92104" },
  { kind: "physical", location: "Best Pizza & Brew - Mira Mesa - $", address: "9172 Mira Mesa Blvd, San Diego, CA 92126" },
  {
    kind: "physical",
    location: "The Reading Club - Embarcadero - $$$\n[Business Casual Dress Code]",
    address: "901 Bayfront Court San Diego, CA 92101",
  },
  { kind: "physical", location: "Tavola Nostra - Hillcrest - $$", address: "1040 University Ave B101, San Diego, CA 92103" },
  { kind: "physical", location: "Bronx Pizza - Hillcrest - $", address: "111 Washington St, San Diego, CA 92103" },
  { kind: "physical", location: "Paradis Coffee - Mission Hills - $", address: "901 W Washington St, San Diego, CA 92103" },
  { kind: "physical", location: "Cardellino - Mission Hills - $$$", address: "4033 Goldfinch St, San Diego, CA 92103" },
  { kind: "physical", location: "Finjan Coffee - Convoy - $", address: "9119 Clairemont Mesa Blvd g, San Diego, CA 92123" },
  { kind: "ask_invitee" },
];

/** Drops zero-length (and inverted) intervals: Calendly's "17:00 to 17:00" means unavailable. */
function availableOnly(weekly: WeeklyHours): WeeklyHours {
  return weekly.map((day: MinuteRange[]) => day.filter((r) => r.end > r.start).map((r) => ({ start: r.start, end: r.end }))) as WeeklyHours;
}

function scheduleOf(key: OwnerScheduleKey): OwnerSnapshotSchedule {
  const s = OWNER_SCHEDULES.find((x) => x.key === key);
  if (!s) throw new Error(`owner snapshot: the demo seed has no schedule "${key}"`);
  return { key: s.key, name: s.name, isDefault: s.isDefault, timezone: s.timezone, weeklyHours: availableOnly(s.weeklyHours) };
}

function eventTypeOf(slug: string, locations: OwnerSnapshotLocation[]): OwnerSnapshotEventType {
  const e = OWNER_EVENT_TYPES.find((x) => x.slug === slug);
  if (!e) throw new Error(`owner snapshot: the demo seed has no event type "${slug}"`);
  return {
    name: e.name,
    slug: e.slug,
    durationMinutes: e.durationMinutes,
    color: e.color.toLowerCase(),
    schedule: e.schedule,
    locations,
    slotIncrementMinutes: e.slotIncrementMinutes,
    bufferBeforeMinutes: e.bufferBeforeMinutes,
    bufferAfterMinutes: e.bufferAfterMinutes,
    minimumNoticeMinutes: MINIMUM_NOTICE_MINUTES,
    dateRange: { type: "rolling", days: ROLLING_DAYS, mode: "calendar_days" },
    limitPerDay: null,
    limitPerWeek: null,
    limitPerMonth: null,
    allowGuests: true,
    autofillInvitee: true,
    questions: [{ label: DISCUSS_QUESTION.label, type: DISCUSS_QUESTION.type, required: DISCUSS_QUESTION.required }],
    inviteeReminderOffsetsMinutes: [REMINDER_24H],
  };
}

export const OWNER_SNAPSHOT: OwnerSnapshot = {
  version: OWNER_SNAPSHOT_VERSION,
  profile: {
    name: OWNER.name,
    slug: OWNER.slug,
    timezone: OWNER.timezone,
    timeFormat: OWNER.timeFormat,
    locale: "en",
    welcomeMessage: OWNER.welcomeMessage,
  },
  meetingLimits: { perDay: null, perWeek: null },
  schedules: [scheduleOf("working_hours"), scheduleOf("block_off_work")],
  eventTypes: [
    eventTypeOf("30min", [{ kind: "google_conference" }]),
    eventTypeOf("60min", [{ kind: "google_conference" }]),
    eventTypeOf("meal", OWNER_MEAL_LOCATIONS),
  ],
};
