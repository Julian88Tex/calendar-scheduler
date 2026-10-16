// OWNER: foundation-ui.
//
// TimeZoneMismatchBanner (SPEC GEN-23): compares the browser zone with the profile zone by UTC offset now and in six
// months (aliases such as Asia/Kolkata and Asia/Calcutta never trigger it) and shows "Your computer's time zone
// ({browser zone}) is different from your profile's ({profile zone}). Update your profile?" with "Update time zone"
// (the shell server action sets the profile zone, never schedule zones) and "Dismiss" (hidden for that browser zone for
// 30 days, localStorage).
"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { friendlyZoneName, zonesEquivalent } from "@/lib/time/zones";
import { Banner } from "../ui/banner";
import { Spinner } from "../ui/spinner";
import { toast } from "../ui/toast";

export type TimeZoneMismatchBannerProps = {
  profileZone: string;
  /** Server action that sets the profile zone (not schedule zones). Returning { ok: false, error } shows the error. */
  updateAction?: (zone: string) => Promise<unknown>;
};

export const TZ_DISMISS_KEY = "kairos_tz_mismatch_dismissed";
export const TZ_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
const noop = () => () => {};
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
};

function dismissedFor(zone: string): boolean {
  try {
    const raw = window.localStorage.getItem(TZ_DISMISS_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return (data[zone] ?? 0) > Date.now();
  } catch {
    return false;
  }
}

function rememberDismissal(zone: string) {
  try {
    const raw = window.localStorage.getItem(TZ_DISMISS_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    for (const [k, v] of Object.entries(data)) if (v <= Date.now()) delete data[k];
    data[zone] = Date.now() + TZ_DISMISS_MS;
    window.localStorage.setItem(TZ_DISMISS_KEY, JSON.stringify(data));
  } catch {
    // storage blocked: dismissed for this page view only
  }
}

export function TimeZoneMismatchBanner({ profileZone, updateAction }: TimeZoneMismatchBannerProps) {
  const zone = useSyncExternalStore(noop, browserZone, () => profileZone);
  const wasDismissed = useSyncExternalStore(noop, () => (zone ? dismissedFor(zone) : false), () => false);
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (hidden || wasDismissed || !zone || zonesEquivalent(zone, profileZone)) return null;
  const dismiss = () => {
    rememberDismissal(zone);
    setHidden(true);
  };
  return (
    <Banner
      variant="info"
      role="status"
      action={
        <>
          {updateAction && (
            <button
              type="button"
              disabled={pending}
              aria-busy={pending || undefined}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              onClick={() =>
                startTransition(async () => {
                  try {
                    const result = (await updateAction(zone)) as { ok?: boolean; error?: { message?: string } } | undefined;
                    if (result && result.ok === false) {
                      toast.error(result.error?.message ?? "Couldn't update your time zone.");
                      return;
                    }
                    setHidden(true);
                    toast.success("Time zone updated", { description: friendlyZoneName(zone) });
                    router.refresh();
                  } catch {
                    toast.error("Couldn't update your time zone.");
                  }
                })
              }
            >
              {pending && <Spinner size="sm" decorative inheritColor />}
              Update time zone
            </button>
          )}
          <button type="button" onClick={dismiss} className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-primary-text hover:bg-primary-soft-2">
            Dismiss
          </button>
        </>
      }
    >
      {`Your computer's time zone (${friendlyZoneName(zone)}) is different from your profile's (${friendlyZoneName(profileZone)}). Update your profile?`}
    </Banner>
  );
}
