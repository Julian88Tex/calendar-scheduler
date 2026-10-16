// OWNER: foundation-ui.
//
// Sheet (ARCHITECTURE 20.2): side panel and mobile drawer (Radix Dialog anchored to an edge, focus trap, Escape and
// scrim close). Full width on phones; bottom sheets get rounded top corners.
"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { OVERLAY_CLASS } from "./dialog";
import { useReturnFocus } from "./use-return-focus";

export type SheetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  side?: "right" | "left" | "bottom";
  size?: "sm" | "md" | "lg";
  hideClose?: boolean;
  /** Visually hide the title (it stays the accessible name), for drawers that show their own header. */
  hideTitle?: boolean;
  className?: string;
  /** Classes for the scrollable body. */
  bodyClassName?: string;
};

const SIDES = {
  right: "inset-y-0 right-0 h-full max-w-full data-[state=open]:animate-sheet-in-right",
  left: "inset-y-0 left-0 h-full max-w-full data-[state=open]:animate-sheet-in-left",
  bottom: "inset-x-0 bottom-0 max-h-[90dvh] w-full rounded-t-[16px] data-[state=open]:animate-sheet-in-bottom",
} as const;
const SIZES = { sm: "w-80", md: "w-[420px]", lg: "w-[640px]" } as const;

export function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  side = "right",
  size = "md",
  hideClose,
  hideTitle,
  className,
  bodyClassName,
}: SheetProps) {
  const returnFocus = useReturnFocus(!trigger);
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY_CLASS} />
        <RadixDialog.Content
          {...returnFocus}
          className={cn("fixed z-50 flex flex-col bg-white text-ink shadow-[var(--shadow-pop)] outline-none", SIDES[side], side !== "bottom" && SIZES[size], className)}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className={cn("shrink-0 px-6 pt-6 pb-2", hideTitle && !description && "p-0")}>
            <RadixDialog.Title className={cn("pr-10 text-title-lg text-ink", hideTitle && "sr-only")}>{title}</RadixDialog.Title>
            {description && <RadixDialog.Description className="mt-1.5 text-body-md text-ink-2">{description}</RadixDialog.Description>}
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6", bodyClassName)}>{children}</div>
          {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
          {!hideClose && (
            <RadixDialog.Close
              aria-label="Close"
              className="absolute top-4 right-4 inline-flex size-9 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-primary-soft hover:text-primary-text"
            >
              <X aria-hidden="true" className="size-5" />
            </RadixDialog.Close>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const SheetClose = RadixDialog.Close;
