// OWNER: foundation-ui.
//
// BackButton (SPEC BK-03, BK-09, walkthrough 11.2): the 44px circular back button with a 1px #D4E0ED border and a blue
// (--primary-color) arrow, used at the top-left of the booking card (back=1) and above the details form. A link when
// `href` is given, else a button.
"use client";

import { ArrowLeft } from "lucide-react";
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
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-public-bg text-brand-strong transition-colors duration-100 hover:bg-brand-hover";

export function BackButton({ href, onClick, label = "Back", className }: BackButtonProps) {
  const icon = <ArrowLeft aria-hidden="true" className="size-5" strokeWidth={2.25} />;
  if (href) {
    return (
      <Link href={href as Route} aria-label={label} onClick={onClick} className={cn(CLASS, className)}>
        {icon}
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cn(CLASS, className)}>
      {icon}
    </button>
  );
}
