// The friends booking link (/friends): the same booking flow as the public page in a warm, personal voice. This file
// holds every friends-only word, so the copy can be tuned in one place. Client and server safe (plain data).
//
// Tone "public" is the classic page; "friends" swaps the strings below in and keeps every other string of the booking
// catalog (lib/t.ts). Event types keep their real names in the dashboard, emails and calendar events; the friends
// pages show the friendly name and blurb of FRIENDLY_EVENTS when the slug is listed there.
import { bt, interpolate, type Vars } from "./t";

export type Tone = "public" | "friends";

/** Path prefix of the friends pages. */
export const FRIENDS_PATH = "/friends";
/** Confirmation pages of bookings made through the friends link. */
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

/** Lines that only the friends pages have. {firstName} is the host's first name. */
export const FRIENDS_COPY = {
  landingTitle: "Hang out with {firstName}",
  greeting: "Hey, friend!",
  note: "I'm really glad you're here. Life gets busy, but time with you is the kind I always want to make room for. Pick whatever works for you and it goes straight on my calendar.",
  signOff: "Can't wait to see you,",
  chooseHeading: "How do you want to hang?",
  detailsIntro: "Just tell me who's coming and I'll save the date.",
  confirmationNote: "Seriously, thanks for making the time. It means a lot.",
  pageTitle: "Pick a time with {firstName}",
  empty: "{firstName} doesn't have any open times right now. Text me and we'll figure something out!",
} as const;

export type FriendlyEvent = { name: string; blurb: string };

/** Friendly names of the owner's event types, by slug. Types not listed keep their own name and description. */
export const FRIENDLY_EVENTS: Record<string, FriendlyEvent> = {
  "30min": { name: "Quick video catch-up", blurb: "Thirty minutes to hear what's new with you." },
  "60min": { name: "Long video hang", blurb: "A whole hour, no rush. Bring the stories." },
  meal: { name: "Grab a meal or coffee", blurb: "My favorite way to catch up. Pick a spot and I'll meet you there." },
};

/** Friendly wording of custom questions, by their exact label. Answers and required rules stay the same. */
export const FRIENDLY_QUESTIONS: Record<string, string> = {
  "What would you like to discuss?": "What's new with you? (Anything goes, even just \"hi\")",
};

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

export function friendlyEventOf(slug: string | null | undefined): FriendlyEvent | null {
  return slug ? (FRIENDLY_EVENTS[slug.toLowerCase()] ?? null) : null;
}

export function friendlyQuestionLabel(label: string): string {
  return FRIENDLY_QUESTIONS[label.trim()] ?? label;
}
