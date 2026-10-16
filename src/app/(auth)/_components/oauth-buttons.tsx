// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// "Continue with Google" and "Continue with Microsoft" (SPEC AU-01 to AU-04): full-width white buttons with the
// provider mark and a 1px border, rendered only for configured providers (the page passes the flags). They are links to
// GET /api/auth/{provider}/start with the intent, the same-site `next` and the browser time zone (new accounts start
// in the visitor's zone, AU-13). Clicking shows a spinner until the provider page loads.
"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { oauthStartPath } from "@/lib/auth/oauth/links";
import type { OAuthIntent, OAuthProviderId } from "@/lib/auth/oauth/types";
import { GoogleMark, MicrosoftMark } from "./brand-marks";

const noop = () => () => {};
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
};
const serverZone = () => "";

export type OAuthButtonsProps = {
  providers: { google: boolean; microsoft: boolean };
  intent: Extract<OAuthIntent, "login" | "signup" | "accept_invitation">;
  next?: string | null;
  invitation?: string | null;
  className?: string;
};

const LABELS: Record<OAuthProviderId, string> = { google: "Continue with Google", microsoft: "Continue with Microsoft" };

export function OAuthButtons({ providers, intent, next, invitation, className }: OAuthButtonsProps) {
  const tz = useSyncExternalStore(noop, browserZone, serverZone);
  const [pending, setPending] = useState<OAuthProviderId | null>(null);
  // Coming back with the browser's back button restores this page from the cache: clear the spinner.
  useEffect(() => {
    const reset = () => setPending(null);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  const list = (["google", "microsoft"] as const).filter((p) => providers[p]);
  if (!list.length) return null;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {list.map((provider) => (
        <a
          key={provider}
          href={oauthStartPath(provider, { intent, next, invitation, tz: tz || null })}
          onClick={() => setPending(provider)}
          aria-busy={pending === provider || undefined}
          className={buttonClassName({
            variant: "secondary",
            size: "lg",
            fullWidth: true,
            className: cn("relative gap-3 font-semibold", pending && pending !== provider && "pointer-events-none opacity-60"),
          })}
        >
          {pending === provider ? (
            <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : provider === "google" ? (
            <GoogleMark />
          ) : (
            <MicrosoftMark />
          )}
          <span>{LABELS[provider]}</span>
        </a>
      ))}
    </div>
  );
}
