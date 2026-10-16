// Friends mode of the public booking pages: the same URLs (/{handle}, /{handle}/{eventSlug}[/{start}], /booking/{id})
// with ?friends=1 switch to a warm, personal voice and theme; ?friends=0 is the classic page with the mode toggle still
// shown (the toggle only appears when the parameter is present). The old /friends paths redirect here. This file holds
// the fixed friends words and the defaults of the editable ones. Client and server safe (plain data).
//
// Tone "public" is the classic page; "friends" swaps the strings below in and keeps every other string of the booking
// catalog (lib/t.ts). Event types keep their real names in the dashboard, emails and calendar events; the friends
// pages show the friendly name and blurb from the host's FriendsContent (Settings > Friends mode) when the slug is listed.
import { bt, interpolate, type Vars } from "./t";

export type Tone = "public" | "friends";

/** Query parameter of friends mode: "1" (or empty) is the friends tone, "0" the classic tone with the toggle shown. */
export const FRIENDS_PARAM = "friends";
/** The old friends link paths (redirects to the parameter version). */
export const FRIENDS_PATH = "/friends";
export const FRIENDS_BOOKED_PATH = "/friends/booked";
/** utm_source stored on bookings made through the friends link (shown with the meeting's tracking details). */
export const FRIENDS_UTM_SOURCE = "friends-link";

/** Friends overrides of booking catalog keys ("page.selectDateTime"); anything not listed reads the normal string. */
const FRIENDS_TEXT: Record<string, string> = {
  "page.selectDateTime": "When works for you?",
  "page.selectDay": "Pick a day",
  "page.selectTimeHeading": "Pick a time",
  "page.noTimes": "Nothing open that day. Try another one?",
  "page.noTimesInMonth": "I'm all booked up in {month}",
  "page.backToLanding": "Back to all the ways to hang",
  "details.title": "Almost there!",
  "details.schedule": "Lock it in",
  "confirmation.title": "It's a date!",
  "confirmation.titleRescheduled": "New time, same plan!",
  "confirmation.withHost": "You and {name} are all set.",
  "confirmation.withHostRescheduled": "You and {name} are all set for the new time.",
  "confirmation.sentTo": "A calendar invite is on its way to your inbox. See you soon!",
  "confirmation.sentEmail": "A confirmation is on its way to your inbox. See you soon!",
  "confirmation.needChanges": "Plans changed? No worries at all.",
  "confirmation.reschedule": "Pick a new time",
  "confirmation.scheduleAnother": "Plan another hang",
};

/** Fixed friends lines. {firstName} is the host's first name. The editable ones live in FriendsContent. */
export const FRIENDS_COPY = {
  landingTitle: "Hang out with {firstName}",
  pageTitle: "Pick a time with {firstName}",
  empty: "{firstName} doesn't have any open times right now. Text me and we'll figure something out!",
} as const;

export type FriendlyEvent = { name: string; blurb: string };
export type FriendsFavorite = { emoji: string; label: string };

/**
 * What the host edits in Settings > Friends mode (users.preferences.friends): the landing page words, the favorites
 * chips, the details and confirmation lines, and friendly names of event types by slug (types not listed keep their
 * own name and description). Missing or empty text falls back to DEFAULT_FRIENDS_CONTENT.
 */
export type FriendsContent = {
  greeting: string;
  note: string;
  signOff: string;
  favoritesHeading: string;
  favorites: FriendsFavorite[];
  chooseHeading: string;
  detailsIntro: string;
  confirmationNote: string;
  events: Record<string, FriendlyEvent>;
};

export const FRIENDS_LIMITS = { short: 80, long: 400, favorites: 6, emoji: 8, events: 30 } as const;

export const DEFAULT_FRIENDS_CONTENT: FriendsContent = {
  greeting: "Hey, friend!",
  note: "Really glad you're here. Life gets busy, but time with you is the kind I want to make room for. Pick whatever works and it goes straight on my calendar.",
  signOff: "Can't wait to see you,",
  favoritesHeading: "Favorite ways to hang",
  favorites: [
    { emoji: "🍕", label: "Pizza" },
    { emoji: "☕", label: "Coffee" },
    { emoji: "🚶", label: "Walk and talk" },
    { emoji: "📞", label: "Catch-up call" },
  ],
  chooseHeading: "How do you want to hang?",
  detailsIntro: "Just tell me who's coming and I'll save the date.",
  confirmationNote: "Seriously, thanks for making the time. It means a lot.",
  events: {
    "30min": { name: "Quick video catch-up", blurb: "Thirty minutes to hear what's new with you." },
    "60min": { name: "Long video hang", blurb: "A whole hour, no rush. Bring the stories." },
    meal: { name: "Grab pizza (or coffee)", blurb: "You pick the spot, I bring the appetite." },
  },
};

const TEXT_KEYS = ["greeting", "note", "signOff", "favoritesHeading", "chooseHeading", "detailsIntro", "confirmationNote"] as const;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** The stored friends settings (any shape) over the defaults: unknown keys dropped, text trimmed and capped. */
export function friendsContentOf(stored: unknown): FriendsContent {
  const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const out: FriendsContent = { ...DEFAULT_FRIENDS_CONTENT };
  for (const k of TEXT_KEYS) {
    const v = clean(raw[k], k === "note" ? FRIENDS_LIMITS.long : FRIENDS_LIMITS.short * 2);
    if (v) out[k] = v;
  }
  if (Array.isArray(raw.favorites)) {
    out.favorites = raw.favorites
      .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : {}))
      .map((f) => ({ emoji: clean(f.emoji, FRIENDS_LIMITS.emoji), label: clean(f.label, FRIENDS_LIMITS.short) }))
      .filter((f) => f.label)
      .slice(0, FRIENDS_LIMITS.favorites);
  }
  if (raw.events && typeof raw.events === "object") {
    const events: Record<string, FriendlyEvent> = {};
    for (const [slug, e] of Object.entries(raw.events as Record<string, unknown>).slice(0, FRIENDS_LIMITS.events)) {
      const ev = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
      const name = clean(ev.name, FRIENDS_LIMITS.short);
      const blurb = clean(ev.blurb, FRIENDS_LIMITS.short * 2);
      if (name || blurb) events[slug.toLowerCase()] = { name, blurb };
    }
    out.events = events;
  }
  return out;
}

/** The friendly name and blurb of an event type (empty parts keep the real name or description), or null. */
export function friendlyEventOf(content: FriendsContent, slug: string | null | undefined): FriendlyEvent | null {
  return slug ? (content.events[slug.toLowerCase()] ?? null) : null;
}

/** Friendly wording of custom questions, by their exact label. Answers and required rules stay the same. */
export const FRIENDLY_QUESTIONS: Record<string, string> = {
  "What would you like to discuss?": "What's new with you? (Anything goes, even just \"hi\")",
};

/** The tone a request asks for: ?friends (any value but "0" or "false") is friends mode. */
export function toneOfParam(value: string | null | undefined): Tone {
  if (value === undefined || value === null) return "public";
  return value === "0" || value === "false" ? "public" : "friends";
}

/** A path with the friends parameter set ("1" or "0"), keeping the rest of its query. */
export function withFriendsParam(href: string, on: boolean): string {
  const [path, query = ""] = href.split("?", 2);
  const q = new URLSearchParams(query);
  q.set(FRIENDS_PARAM, on ? "1" : "0");
  return `${path}?${q.toString()}`;
}

/** The booking string for a key in the given tone (see bt). */
export function toneText(tone: Tone | undefined, key: string, vars?: Vars): string {
  const own = tone === "friends" ? FRIENDS_TEXT[key] : undefined;
  return own === undefined ? bt(key, vars) : interpolate(own, vars);
}

/** A friends-only line with {firstName} filled in. */
export function friendsLine(key: keyof typeof FRIENDS_COPY, firstName: string): string {
  return interpolate(FRIENDS_COPY[key], { firstName });
}

/** "Julian" from "Julian Joseph" (the whole name when it has one word, "me" when empty). */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "me";
}

export function friendlyQuestionLabel(label: string): string {
  return FRIENDLY_QUESTIONS[label.trim()] ?? label;
}
