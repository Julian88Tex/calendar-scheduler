// The ?friends query parameter of friends mode (lib/friends.ts), on its own so the mode toggle's client island does not
// pull in the booking string catalog (lib/t.ts) with lib/friends.ts (GEN-07). Client and server safe.

/** Query parameter of friends mode: "1" (or empty) is the friends tone, "0" the classic tone with the toggle shown. */
export const FRIENDS_PARAM = "friends";

/** A path with the friends parameter set ("1" or "0"), keeping the rest of its query. */
export function withFriendsParam(href: string, on: boolean): string {
  const [path, query = ""] = href.split("?", 2);
  const q = new URLSearchParams(query);
  q.set(FRIENDS_PARAM, on ? "1" : "0");
  return `${path}?${q.toString()}`;
}
