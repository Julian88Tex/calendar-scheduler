// The warm look of persona pages (lib/personas.ts): personas with the "warm" style swap the booking strings below in
// (tone "friends", with the friends theme in globals.css); tone "public" is the classic page and every other string
// comes from the booking catalog (lib/t.ts). Also the ?for= link parameter that picks a persona and the old /friends
// paths, which redirect to the built-in friends persona. Kept small: the public booking page's client components
// import it (JS budget, GEN-07). Client and server safe (plain data).
import { bt, interpolate, type Vars } from "./t";

export type Tone = "public" | "friends";

export { PERSONA_PARAM } from "./persona-limits";
/** The old friends link paths (redirects to ?for=friends). */
export const FRIENDS_PATH = "/friends";
export const FRIENDS_BOOKED_PATH = "/friends/booked";

/** Friends overrides of booking catalog keys ("page.selectDateTime"); anything not listed reads the normal string. */
export const FRIENDS_TEXT: Record<string, string> = {
  "page.selectDateTime": "When works for you?",
  "page.selectDay": "Pick a day",
  "page.selectTimeHeading": "Pick a time",
  "page.noTimes": "Nothing open that day. Try another one?",
  "page.noTimesInMonth": "I'm all booked up in {month}",
  "page.backToLanding": "Back to all the options",
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
  "confirmation.scheduleAnother": "Book another time",
};

/** The booking string for a key in the given tone (see bt). */
export function toneText(tone: Tone | undefined, key: string, vars?: Vars): string {
  const own = tone === "friends" ? FRIENDS_TEXT[key] : undefined;
  return own === undefined ? bt(key, vars) : interpolate(own, vars);
}
