// OWNER: foundation-ui.
//
// ToneToggle: the Friends / Business switch of friends mode (lib/friends.ts). Shown only on pages opened with the
// ?friends parameter; each side links to the current URL (path and query as they are now, so a picked month or date
// survives) with friends=1 or friends=0.
"use client";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { withFriendsParam, type Tone } from "@/components/booking/lib/friends";
import { cn } from "@/lib/cn";

export function ToneToggle({ tone, className }: { tone: Tone; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const here = `${pathname}${search.size ? `?${search.toString()}` : ""}`;
  const options: { on: boolean; label: string }[] = [
    { on: true, label: "Friends" },
    { on: false, label: "Business" },
  ];
  return (
    <nav aria-label="Page style" data-testid="tone-toggle" className={cn("inline-flex rounded-full border border-line bg-public-bg p-0.5 text-[13px] leading-5 font-semibold", className)}>
      {options.map((o) => {
        const active = (tone === "friends") === o.on;
        return (
          <Link
            key={o.label}
            href={withFriendsParam(here, o.on) as Route}
            aria-current={active ? "page" : undefined}
            replace
            scroll={false}
            className={cn(
              "rounded-full px-3 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
              active ? "bg-primary text-white" : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
