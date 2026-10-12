// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// AlertDialog and ConfirmDialog (ARCHITECTURE 20.2): interrupting confirmations (Radix AlertDialog: no outside click
// dismiss). ConfirmDialog is the common "Cancel" / "Confirm" form with a destructive variant and an async onConfirm.
"use client";

import * as RadixAlert from "@radix-ui/react-alert-dialog";
import { useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export type AlertDialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** The action buttons (use AlertDialogCancel / AlertDialogAction to close). */
  footer: React.ReactNode;
  className?: string;
};

export function AlertDialog({ open, defaultOpen, onOpenChange, trigger, title, description, children, footer, className }: AlertDialogProps) {
  return (
    <RadixAlert.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger && <RadixAlert.Trigger asChild>{trigger}</RadixAlert.Trigger>}
      <RadixAlert.Portal>
        <RadixAlert.Overlay className="fixed inset-0 z-40 bg-[var(--overlay)]" />
        <RadixAlert.Content
          className={cn("fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-pop)]", className)}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <RadixAlert.Title className="text-title-md">{title}</RadixAlert.Title>
          {description && <RadixAlert.Description className="mt-2 text-body-md text-ink-2">{description}</RadixAlert.Description>}
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-6 flex justify-end gap-2">{footer}</div>
        </RadixAlert.Content>
      </RadixAlert.Portal>
    </RadixAlert.Root>
  );
}

export const AlertDialogCancel = RadixAlert.Cancel;
export const AlertDialogAction = RadixAlert.Action;

export type ConfirmDialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Default "Confirm". */
  confirmLabel?: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  variant?: "default" | "destructive";
  /** May be async: the confirm button shows loading and the dialog closes when it resolves (stays open if it throws). */
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  confirmDisabled?: boolean;
};

export function ConfirmDialog({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  loading,
  confirmDisabled,
}: ConfirmDialogProps) {
  const [inner, setInner] = useState(defaultOpen ?? false);
  const [busy, setBusy] = useState(false);
  const isOpen = open ?? inner;
  const setOpen = (v: boolean) => {
    if (open === undefined) setInner(v);
    onOpenChange?.(v);
  };
  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={setOpen}
      trigger={trigger}
      title={title}
      description={description}
      footer={
        <>
          <AlertDialogCancel asChild>
            <Button variant="secondary">{cancelLabel}</Button>
          </AlertDialogCancel>
          <Button
            variant={variant === "destructive" ? "destructive" : "primary"}
            loading={loading || busy}
            disabled={confirmDisabled}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </AlertDialog>
  );
}
