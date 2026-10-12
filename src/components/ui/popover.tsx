// OWNER: foundation-ui.
//
// Popover (ARCHITECTURE 20.2, Radix Popover): white panel, 1px #D4E0ED border, 8px radius, pop shadow; Escape and
// outside click close it and focus returns to the trigger.
"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type PopoverProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The element that toggles the popover (rendered with asChild). */
  trigger: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  modal?: boolean;
  className?: string;
  "aria-label"?: string;
  /** Called when the popover opens; preventDefault() keeps focus on the trigger. */
  onOpenAutoFocus?: (event: Event) => void;
};

export function Popover({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  children,
  side = "bottom",
  align = "center",
  sideOffset = 6,
  modal,
  className,
  onOpenAutoFocus,
  ...aria
}: PopoverProps) {
  return (
    <RadixPopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} modal={modal}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          onOpenAutoFocus={onOpenAutoFocus}
          className={cn(
            "z-50 max-w-[calc(100vw-16px)] rounded-[var(--radius-card)] border border-line bg-white p-4 text-ink shadow-[var(--shadow-pop)] outline-none",
            "data-[state=open]:animate-pop-in",
            className,
          )}
          {...aria}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

export const PopoverClose = RadixPopover.Close;
