// OWNER: foundation-ui.
//
// Tooltip (ARCHITECTURE 20.2, Radix): wraps one focusable trigger element; shows on hover and keyboard focus, hides on
// Escape. Navy chip with 12px text (theme aware).
"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type TooltipProps = {
  content: React.ReactNode;
  /** The trigger (must accept a ref and be focusable). */
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  disabled?: boolean;
  className?: string;
};

export function Tooltip({ content, children, side = "top", align = "center", delayDuration = 300, disabled, className }: TooltipProps) {
  if (disabled) return children;
  return (
    <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "z-[70] max-w-60 rounded-[4px] bg-navy px-2.5 py-1.5 text-[12px] leading-4 font-semibold text-surface shadow-[var(--shadow-pop)]",
              "data-[state=delayed-open]:animate-fade-in data-[state=instant-open]:animate-fade-in",
              className,
            )}
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

export const TooltipProvider = RadixTooltip.Provider;
