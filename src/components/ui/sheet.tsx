// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Sheet (ARCHITECTURE 20.2): side panel and mobile drawer (Radix Dialog anchored to an edge).
"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";

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
};

const SIDES = {
  right: "inset-y-0 right-0 h-full",
  left: "inset-y-0 left-0 h-full",
  bottom: "inset-x-0 bottom-0 max-h-[90vh] w-full rounded-t-[var(--radius-card)]",
} as const;
const SIZES = { sm: "w-80", md: "w-[420px]", lg: "w-[640px]" } as const;

export function Sheet({ open, defaultOpen, onOpenChange, trigger, title, description, children, footer, side = "right", size = "md", hideClose, hideTitle, className }: SheetProps) {
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-[var(--overlay)]" />
        <RadixDialog.Content
          className={cn("fixed z-50 flex max-w-full flex-col overflow-y-auto bg-white p-6 shadow-[var(--shadow-pop)]", SIDES[side], side !== "bottom" && SIZES[size], className)}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <RadixDialog.Title className={cn("pr-8 text-title-md", hideTitle && "sr-only")}>{title}</RadixDialog.Title>
          {description && <RadixDialog.Description className="mt-1 text-body-md text-ink-2">{description}</RadixDialog.Description>}
          <div className="mt-4 flex-1">{children}</div>
          {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
          {!hideClose && (
            <RadixDialog.Close aria-label="Close" className="absolute top-4 right-4 rounded-full p-1 text-ink-2 hover:bg-pebble">
              <X aria-hidden="true" className="size-5" />
            </RadixDialog.Close>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const SheetClose = RadixDialog.Close;
