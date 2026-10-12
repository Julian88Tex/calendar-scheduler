// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// TimeZoneMismatchBanner (SPEC GEN-23): compares the browser zone with the profile zone by UTC offset now and in six
// months (aliases never trigger it); "Update time zone" calls the shell server action, "Dismiss" hides it for that
// browser zone for 30 days (localStorage).
"use client";

import { useState, useSyncExternalStore } from "react";
import { friendlyZoneName, zonesEquivalent } from "@/lib/time/zones";
import { Banner } from "../ui/banner";

export type TimeZoneMismatchBannerProps = {
  profileZone: string;
  /** Server action that sets the profile zone (not schedule zones). */
  updateAction?: (zone: string) => Promise<void>;
};

const DISMISS_KEY = "kairos_tz_mismatch_dismissed";
const noop = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function dismissedFor(zone: string): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return (data[zone] ?? 0) > Date.now();
  } catch {
    return false;
  }
}

export function TimeZoneMismatchBanner({ profileZone, updateAction }: TimeZoneMismatchBannerProps) {
  const zone = useSyncExternalStore(noop, browserZone, () => profileZone);
  const [hidden, setHidden] = useState(false);
  if (hidden || !zone || zonesEquivalent(zone, profileZone) || dismissedFor(zone)) return null;
  return (
    <Banner
      variant="info"
      dismissible
      onDismiss={() => {
        try {
          const raw = window.localStorage.getItem(DISMISS_KEY);
          const data = raw ? (JSON.parse(raw) as Record<string, number>) : {};
          data[zone] = Date.now() + 30 * 24 * 60 * 60 * 1000;
          window.localStorage.setItem(DISMISS_KEY, JSON.stringify(data));
        } catch {
          // storage blocked: dismissed for this page view only
        }
      }}
      action={
        updateAction ? (
          <button
            type="button"
            className="font-semibold underline"
            onClick={async () => {
              await updateAction(zone);
              setHidden(true);
            }}
          >
            Update time zone
          </button>
        ) : undefined
      }
    >
      {`Your computer's time zone (${friendlyZoneName(zone)}) is different from your profile's (${friendlyZoneName(profileZone)}). Update your profile?`}
    </Banner>
  );
}
