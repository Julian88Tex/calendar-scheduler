// OWNER: foundation-ui.
//
// BackButton (SPEC BK-03, BK-09, walkthrough 11.2, docs/research/calendly-live-capture.md item 1): the 43px circular
// back button with a 1px #D4E0ED border and a blue (--primary-color) 16x14 arrow with a heavy stroke, used at the
// top-left of the booking card's details panel (back=1 and the details step) and in the phone times view. A link when
// `href` is given, else a button.
"use client";

import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/cn";

export type BackButtonProps = {
  href?: string;
  onClick?: () => void;
  /** Accessible name (default "Back"). */
  label?: string;
  className?: string;
};

const CLASS =
  "inline-flex size-[43px] shrink-0 items-center justify-center rounded-full border border-line bg-public-bg text-brand-strong transition-colors duration-100 hover:bg-brand-hover";

/**
 * Calendly's arrow: 16px wide and 14px tall once stroked (lucide's ArrowLeft draws a smaller, lighter square glyph),
 * set 1px below the circle's center as Calendly's is: a 2.05 head and a crisp 2px shaft (the glyph box lands on
 * whole pixels, so a 2px stroke centered on y=8 fills exactly two rows).
 */
function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 16" className="h-4 w-[18px] translate-y-px fill-none stroke-current" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2 2 8l6 6" strokeWidth={2.05} />
      <path d="M2.5 8H16" strokeWidth={2} />
    </svg>
  );
}

export function BackButton({ href, onClick, label = "Back", className }: BackButtonProps) {
  if (href) {
    return (
      <Link href={href as Route} aria-label={label} onClick={onClick} className={cn(CLASS, className)}>
        <Arrow />
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cn(CLASS, className)}>
      <Arrow />
    </button>
  );
}
