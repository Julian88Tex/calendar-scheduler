// OWNER: foundation-ui.
//
// LandingEvents and LandingFooter (SPEC BK-01, BK-02; owner reference .reference/profile.png): the landing card body
// below the ProfileHeader. On desktop the event grid sits in a 760px column (150px side padding in the 1060px card)
// and the footer links sit at the card's bottom-left corner, beside the last row; on tablets and phones the grid
// spans the card and the footer follows it. Server and client safe.
import type * as React from "react";
import { cn } from "@/lib/cn";

/** Wraps the EventTypeList (or the "no event types" message) with the observed column padding. */
export function LandingEvents({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-0 min-[650px]:px-10 min-[1000px]:px-[150px]", className)}>{children}</div>;
}

/**
 * The landing page footer links: absolute at the bottom-left on desktop (the card must be `relative`), stacked so they
 * stay inside the 150px margin beside the event grid; in flow below the grid otherwise.
 */
export function LandingFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "px-6 pt-6 pb-6 min-[1000px]:absolute min-[1000px]:bottom-[22px] min-[1000px]:left-8 min-[1000px]:max-w-[110px] min-[1000px]:p-0",
        "min-[1000px]:[&_nav]:flex-col min-[1000px]:[&_nav]:items-start min-[1000px]:[&_nav]:gap-y-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** "{Name} doesn't have any events available right now." (BK-01 edge case, our choice copy). */
export function LandingEmpty({ name, className }: { name: string; className?: string }) {
  return (
    <p className={cn("border-t border-line px-6 py-16 text-center text-[16px] leading-6 text-ink-2", className)}>
      {`${name} doesn't have any events available right now.`}
    </p>
  );
}
