// OWNER: foundation-ui.
//
// AlertDialog and ConfirmDialog (ARCHITECTURE 20.2): interrupting confirmations (Radix AlertDialog: focus trap, no
// outside click dismiss, Escape cancels, focus returns to the trigger). ConfirmDialog is the common "Cancel" /
// "Confirm" form with a destructive variant (#D53C00 confirm button) and an async onConfirm: the confirm button shows
// loading, the dialog closes when it resolves and stays open (with an error toast) when it throws.
"use client";

import * as RadixAlert from "@radix-ui/react-alert-dialog";
import { useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { OVERLAY_CLASS } from "./dialog";
import { toast } from "./toast";

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
        <RadixAlert.Overlay className={OVERLAY_CLASS} />
        <RadixAlert.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
            "rounded-[var(--radius-card)] bg-white p-6 text-ink shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-pop-in",
            className,
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <RadixAlert.Title className="text-title-lg text-ink">{title}</RadixAlert.Title>
          {description && <RadixAlert.Description className="mt-2 text-body-md text-ink-2">{description}</RadixAlert.Description>}
          {children && <div className="mt-4 text-body-md">{children}</div>}
          <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>
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

function errorMessage(e: unknown): string {
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === "string" && message && !/^[A-Z_]+$/.test(message) ? message : "Something went wrong. Try again.";
}

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
    if (busy && !v) return;
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
            <Button variant="secondary" disabled={busy}>
              {cancelLabel}
            </Button>
          </AlertDialogCancel>
          <Button
            variant={variant === "destructive" ? "destructive" : "primary"}
            loading={loading || busy}
            disabled={confirmDisabled}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setBusy(false);
                if (open === undefined) setInner(false);
                onOpenChange?.(false);
              } catch (e) {
                setBusy(false);
                toast.error(errorMessage(e));
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
