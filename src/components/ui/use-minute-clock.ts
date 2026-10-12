// OWNER: foundation-ui.
//
// useMinuteClock: the current time in ms, refreshed at every minute boundary (time zone pickers show "(6:53pm)").
// Returns null during server rendering and hydration, so markup never mismatches; components render the time only
// once it is known. Client components only.
"use client";

import { useSyncExternalStore } from "react";

let current = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function tick() {
  current = Date.now();
  listeners.forEach((l) => l());
  timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    current = Date.now();
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** Minute-resolution snapshot (stable between ticks so React does not re-render in a loop). */
const snapshot = () => (current ? current - (current % 60_000) : Date.now() - (Date.now() % 60_000));
const serverSnapshot = () => null;

export function useMinuteClock(): number | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
