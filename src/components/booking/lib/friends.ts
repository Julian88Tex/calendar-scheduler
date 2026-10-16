// Friends mode of the public booking pages: the same URLs (/{handle}, /{handle}/{eventSlug}[/{start}], /booking/{id})
// with ?friends=1 switch to a warm, personal voice and theme; ?friends=0 is the classic page with the mode toggle still
// shown (the toggle only appears when the parameter is present). The old /friends paths redirect here. This file holds
// the fixed friends words and the defaults of the editable ones. Client and server safe (plain data).
//
// Tone "public" is the classic page; "friends" swaps the strings below in and keeps every other string of the booking
// catalog (lib/t.ts). Event types keep their real names in the dashboard, emails and calendar events; the friends
// pages show the friendly name and blurb from the host's FriendsContent (lib/friends-content.ts) when the slug is listed.
// Kept small: the public booking page's client components import it (JS budget, GEN-07).
import { bt, interpolate, type Vars } from "./t";

export type Tone = "public" | "friends";

export { FRIENDS_PARAM, withFriendsParam } from "./friends-param";
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

/** Fixed friends lines. {firstName} is the host's first name. The editable ones live in FriendsContent. */
export const FRIENDS_COPY = {
  landingTitle: "Time with {firstName}",
  pageTitle: "Pick a time with {firstName}",
  empty: "{firstName} doesn't have any open times right now. Text me and we'll figure something out!",
} as const;

/** The tone a request asks for: ?friends (any value but "0" or "false") is friends mode. */
export function toneOfParam(value: string | null | undefined): Tone {
  if (value === undefined || value === null) return "public";
  return value === "0" || value === "false" ? "public" : "friends";
}

/** The booking string for a key in the given tone (see bt). */
export function toneText(tone: Tone | undefined, key: string, vars?: Vars): string {
  const own = tone === "friends" ? FRIENDS_TEXT[key] : undefined;
  return own === undefined ? bt(key, vars) : interpolate(own, vars);
}
