// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// PublicCard (ARCHITECTURE 20.2, SPEC section 8): the centered white card of public pages (1px #D4E0ED border, 8px
// radius, card shadow), optionally with the PoweredByRibbon. Width animates when the booking flow expands.
import type * as React from "react";
import { cn } from "@/lib/cn";
import { PoweredByRibbon } from "./powered-by-ribbon";

export type PublicCardProps = {
  children: React.ReactNode;
  /** narrow (forms, confirmations), default (landing), wide (booking calendar plus slots). */
  width?: "narrow" | "default" | "wide";
  /** Show the Powered by ribbon (default true; false when branding hides it, BR-06). */
  ribbon?: boolean;
  className?: string;
};

const WIDTHS = { narrow: "max-w-[640px]", default: "max-w-[1060px]", wide: "max-w-[1060px]" } as const;

export function PublicCard({ children, width = "default", ribbon = true, className }: PublicCardProps) {
  return (
    <div className={cn("relative mx-auto w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-[var(--public-bg)] text-[var(--public-text)] shadow-[var(--shadow-card)] transition-[width] duration-[220ms] ease-out", WIDTHS[width], className)}>
      {ribbon && <PoweredByRibbon />}
      {children}
    </div>
  );
}
