// OWNER: foundation-ui.
//
// Dialog (ARCHITECTURE 20.2, SPEC GEN-05): Radix Dialog with a focus trap that restores focus on close, Escape to close,
// the --overlay scrim and the classic modal look (white, 8px radius, pop shadow, 24px title). Controlled (open +
// onOpenChange) or uncontrolled with a trigger. Use DialogClose for footer buttons that close it. The body scrolls
// inside the dialog; on phones the dialog keeps a 16px gutter.
"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { useReturnFocus } from "./use-return-focus";

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
  /** Visually hide the title (it stays the accessible name). */
  hideTitle?: boolean;
  /** Prevent closing by clicking the scrim (forms with unsaved input). */
  preventOutsideClose?: boolean;
  /** Classes for the scrollable body. */
  bodyClassName?: string;
};

const WIDTHS: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[calc(100vw-2rem)]",
};

export const OVERLAY_CLASS = "fixed inset-0 z-40 bg-[var(--overlay)] data-[state=open]:animate-fade-in";

export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  size = "md",
  hideClose,
  className,
  hideTitle,
  preventOutsideClose,
  bodyClassName,
}: DialogProps) {
  const returnFocus = useReturnFocus(!trigger);
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY_CLASS} />
        <RadixDialog.Content
          {...returnFocus}
          onPointerDownOutside={preventOutsideClose ? (e) => e.preventDefault() : undefined}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "rounded-[var(--radius-card)] bg-white text-ink shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-pop-in",
            WIDTHS[size],
            className,
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className={cn("shrink-0 px-6 pt-6", hideTitle && !description ? "pb-0" : "pb-2")}>
            <RadixDialog.Title className={cn("pr-10 text-headline-3 text-ink", hideTitle && "sr-only")}>{title}</RadixDialog.Title>
            {description && <RadixDialog.Description className="mt-1.5 text-body-md text-ink-2">{description}</RadixDialog.Description>}
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6", footer && "pb-4", bodyClassName)}>{children}</div>
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

/** Closes the surrounding Dialog or Sheet (wrap a Button with asChild). */
export const DialogClose = RadixDialog.Close;
