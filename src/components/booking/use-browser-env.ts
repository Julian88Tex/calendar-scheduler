// Browser-only values of the booking flow, read with useSyncExternalStore so server rendering and hydration render the
// same markup (null on the server) and the client value follows right after (SPEC BK-05 default zone = browser zone,
// GEN-06 "am/pm | 24h" remembered in localStorage, BK-16 autofill, BK-33 toggle). Client only.
"use client";

import { useSyncExternalStore } from "react";
import { localePrefers24h } from "@/lib/time/clock";
import { isValidTimeZone } from "@/lib/time/zones";

const FORMAT_KEY = "kairos:timeFormat";
const SHOW_FREE_KEY = "kairos:showFree";
export const AUTOFILL_KEY = "kairos:invitee";
const CHANGE_EVENT = "kairos:storage";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    const s = storage();
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // blocked storage: the choice lasts for this page only
  }
}

const subscribeStorage = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
};
const noopSubscribe = () => () => {};
const serverNull = () => null;

function browserZoneSnapshot(): string | null {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(z) ? z : "UTC";
  } catch {
    return "UTC";
  }
}

/** The browser's IANA zone (null during server rendering and hydration). */
export function useBrowserZone(): string | null {
  return useSyncExternalStore(noopSubscribe, browserZoneSnapshot, serverNull);
}

function formatSnapshot(): "12h" | "24h" | null {
  const stored = read(FORMAT_KEY);
  if (stored === "12h" || stored === "24h") return stored;
  try {
    return localePrefers24h(navigator.language || "en-US") ? "24h" : "12h";
  } catch {
    return "12h";
  }
}

/** The remembered "am/pm | 24h" choice, else the browser locale's preference (null on the server). */
export function useTimeFormat(): "12h" | "24h" | null {
  return useSyncExternalStore(subscribeStorage, formatSnapshot, serverNull);
}

export function rememberTimeFormat(f: "12h" | "24h"): void {
  writeStored(FORMAT_KEY, f);
}

const showFreeSnapshot = () => read(SHOW_FREE_KEY) === "1";
const serverFalse = () => false;

/** BK-33 toggle state (persisted in localStorage). */
export function useShowFree(): boolean {
  return useSyncExternalStore(subscribeStorage, showFreeSnapshot, serverFalse);
}

export function rememberShowFree(on: boolean): void {
  writeStored(SHOW_FREE_KEY, on ? "1" : null);
}

export type AutofillData = { name?: string; firstName?: string; lastName?: string; email?: string };

const autofillSnapshot = () => read(AUTOFILL_KEY);

/** BK-16: the stored invitee (raw JSON string; parse with parseAutofill). */
export function useAutofillRaw(): string | null {
  return useSyncExternalStore(subscribeStorage, autofillSnapshot, serverNull);
}

export function parseAutofill(raw: string | null): AutofillData | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const str = (x: unknown) => (typeof x === "string" && x.trim() && x.length <= 320 ? x.trim() : undefined);
    const out: AutofillData = { name: str(v.name), firstName: str(v.firstName), lastName: str(v.lastName), email: str(v.email) };
    return out.email ? out : null;
  } catch {
    return null;
  }
}

export function rememberAutofill(data: AutofillData): void {
  writeStored(AUTOFILL_KEY, JSON.stringify(data));
}

export function forgetAutofill(): void {
  writeStored(AUTOFILL_KEY, null);
}
