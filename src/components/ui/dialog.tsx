// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Dialog (ARCHITECTURE 20.2): modal with focus trap, Escape to close and the --overlay scrim (Radix Dialog).
// Controlled (open + onOpenChange) or uncontrolled with a trigger. Use DialogClose for footer buttons that close it.
"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type DialogSize = "sm" | "md" | "lg" | "xl" | "full";

export type DialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog (rendered with asChild). */
  trigger?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Buttons row at the bottom (right aligned). */
  footer?: React.ReactNode;
  size?: DialogSize;
  /** Hide the X close button. */
  hideClose?: boolean;
  className?: string;
};

const WIDTHS: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[calc(100vw-2rem)]",
};

export function Dialog({ open, defaultOpen, onOpenChange, trigger, title, description, children, footer, size = "md", hideClose, className }: DialogProps) {
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-[var(--overlay)]" />
        <RadixDialog.Content
          className={cn("fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-pop)]", WIDTHS[size], className)}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <RadixDialog.Title className="pr-8 text-title-md">{title}</RadixDialog.Title>
          {description && <RadixDialog.Description className="mt-1 text-body-md text-ink-2">{description}</RadixDialog.Description>}
          <div className="mt-4">{children}</div>
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

/** Closes the surrounding Dialog or Sheet (wrap a Button with asChild). */
export const DialogClose = RadixDialog.Close;
