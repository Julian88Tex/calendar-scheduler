// The editable side of friends mode (lib/friends.ts): what the host sets in Settings > Friends mode, its defaults, and
// the friendly event names and question labels. Server-side and the settings form only; kept out of lib/friends.ts so
// the public booking page's client JS does not carry it (GEN-07).
import { FRIENDS_COPY } from "./friends";
import { interpolate } from "./t";

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
