// OWNER: foundation-ui.
//
// PublicCard (ARCHITECTURE 20.2, SPEC section 8, BK-01): the centered white card of public pages (1px #D4E0ED border,
// 8px radius, shadow 0 1px 8px 0 rgb(0 0 0 / 8%)), optionally with the PoweredByRibbon in its top-right corner. Below
// 600px the card is full-bleed (no border, radius or shadow). The card does not clip its content so the ribbon can
// overhang by 5px. Server and client safe.
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
  /** Embed variant (BK-25): no border, 20px radius and the soft embed shadow. */
  embed?: boolean;
  /** Ribbon link target (default "/"). */
  ribbonHref?: string;
};

const WIDTHS = { narrow: "max-w-[640px]", default: "max-w-[1060px]", wide: "max-w-[1060px]" } as const;

export function PublicCard({ children, width = "default", ribbon = true, className, embed, ribbonHref }: PublicCardProps) {
  return (
    <div
      className={cn(
        "relative mx-auto w-full bg-public-bg text-public-text transition-[width,max-width,min-width] duration-[220ms] ease-out",
        embed
          ? "rounded-[20px] shadow-[var(--shadow-embed)]"
          : "min-[600px]:rounded-[var(--radius-card)] min-[600px]:border min-[600px]:border-line min-[600px]:shadow-[var(--shadow-card)]",
        WIDTHS[width],
        className,
      )}
    >
      {ribbon && <PoweredByRibbon href={ribbonHref} />}
      {children}
    </div>
  );
}
