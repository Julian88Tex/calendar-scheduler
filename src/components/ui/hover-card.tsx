// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// HoverCard (ARCHITECTURE 20.2, Radix): rich preview on hover or focus (contact hover cards).
"use client";

import * as RadixHoverCard from "@radix-ui/react-hover-card";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type HoverCardProps = {
  /** The trigger element. */
  children: React.ReactElement;
  content: React.ReactNode;
  openDelay?: number;
  closeDelay?: number;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
};

export function HoverCard({ children, content, openDelay = 300, closeDelay = 100, side = "bottom", align = "start", className }: HoverCardProps) {
  return (
    <RadixHoverCard.Root openDelay={openDelay} closeDelay={closeDelay}>
      <RadixHoverCard.Trigger asChild>{children}</RadixHoverCard.Trigger>
      <RadixHoverCard.Portal>
        <RadixHoverCard.Content side={side} align={align} sideOffset={6} className={cn("z-50 w-72 rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-pop)]", className)}>
          {content}
        </RadixHoverCard.Content>
      </RadixHoverCard.Portal>
    </RadixHoverCard.Root>
  );
}
