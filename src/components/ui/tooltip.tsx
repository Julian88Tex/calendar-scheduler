// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Tooltip (ARCHITECTURE 20.2, Radix): wraps one focusable trigger element.
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
    <RadixTooltip.Provider delayDuration={delayDuration}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content side={side} align={align} sideOffset={6} className={cn("z-50 rounded bg-ink px-2 py-1 text-body-sm text-white", className)}>
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

export const TooltipProvider = RadixTooltip.Provider;
