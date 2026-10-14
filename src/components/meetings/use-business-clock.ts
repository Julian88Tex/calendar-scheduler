// The business clock in the browser (ARCHITECTURE 26 rule 8): the server's now() at render time plus the minutes that
// passed since, so the "Mark as no-show" control appears once a meeting starts by the same clock the server uses (also
// under the E2E fake clock). Null during server rendering and hydration. Client components only.
"use client";

import { useMinuteClock } from "@/components/ui/use-minute-clock";

const offsets = new Map<number, number>();

/** Server minus browser clock, measured once per server render (the first time a component asks). */
function offsetFor(serverNow: number): number {
  let o = offsets.get(serverNow);
  if (o === undefined) {
    o = serverNow - Date.now();
    if (offsets.size > 50) offsets.clear();
    offsets.set(serverNow, o);
  }
  return o;
}

export function useBusinessClock(serverNow: number): number | null {
  const tick = useMinuteClock();
  if (tick === null) return null;
  return Math.max(serverNow, tick + offsetFor(serverNow));
}
