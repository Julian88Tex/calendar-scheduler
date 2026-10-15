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

/** Calendly's arrow: 16px wide and 14px tall once stroked (lucide's ArrowLeft draws a smaller, lighter square glyph). */
function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 16" className="h-4 w-[18px] fill-none stroke-current" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2 2 8l6 6M2.5 8H16" />
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
