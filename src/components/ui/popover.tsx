// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Popover (ARCHITECTURE 20.2, Radix Popover).
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
};

export function Popover({ open, defaultOpen, onOpenChange, trigger, children, side = "bottom", align = "center", sideOffset = 6, modal, className, ...aria }: PopoverProps) {
  return (
    <RadixPopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} modal={modal}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          className={cn("z-50 rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-pop)]", className)}
          {...aria}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

export const PopoverClose = RadixPopover.Close;
