// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Toasts (ARCHITECTURE 20.2): toast("Changes saved"), toast.success(...), toast.error(...), toast.info(...),
// toast.dismiss(id?) from any client component; <Toaster /> (root layout) renders them bottom-center in an aria-live
// region. Foundation stub: a tiny module-level store.
"use client";

import { useSyncExternalStore } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type ToastKind = "success" | "error" | "info";

export type ToastOptions = {
  kind?: ToastKind;
  description?: React.ReactNode;
  /** Default 4000 ms (errors 6000 ms); Infinity keeps it until dismissed. */
  durationMs?: number;
  action?: { label: string; onClick: () => void };
  /** Reusing an id replaces that toast. */
  id?: string;
};

export type ToastItem = { id: string; message: React.ReactNode; kind: ToastKind; description?: React.ReactNode; action?: ToastOptions["action"] };

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let counter = 0;

function dismiss(id?: string): void {
  items = id ? items.filter((t) => t.id !== id) : [];
  emit();
}

function show(message: React.ReactNode, opts: ToastOptions = {}): string {
  const id = opts.id ?? `toast-${++counter}`;
  const kind = opts.kind ?? "info";
  items = [...items.filter((t) => t.id !== id), { id, message, kind, description: opts.description, action: opts.action }];
  emit();
  const duration = opts.durationMs ?? (kind === "error" ? 6000 : 4000);
  if (Number.isFinite(duration)) setTimeout(() => dismiss(id), duration);
  return id;
}

export const toast = Object.assign(show, {
  success: (message: React.ReactNode, opts: Omit<ToastOptions, "kind"> = {}) => show(message, { ...opts, kind: "success" }),
  error: (message: React.ReactNode, opts: Omit<ToastOptions, "kind"> = {}) => show(message, { ...opts, kind: "error" }),
  info: (message: React.ReactNode, opts: Omit<ToastOptions, "kind"> = {}) => show(message, { ...opts, kind: "info" }),
  dismiss,
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;
// One stable empty list: useSyncExternalStore requires a cached server snapshot (a new [] per call loops).
const NO_TOASTS: ToastItem[] = [];
const serverSnapshot = (): ToastItem[] => NO_TOASTS;

export type ToastProps = {
  message: React.ReactNode;
  kind?: ToastKind;
  description?: React.ReactNode;
  action?: ToastOptions["action"];
  /** Shows a dismiss button when given. */
  onDismiss?: () => void;
  className?: string;
};

/** One toast (rendered by <Toaster />; also usable inline, for example on /app/dev/ui). */
export function Toast({ message, kind = "info", description, action, onDismiss, className }: ToastProps) {
  return (
    <div
      className={cn(
        "pointer-events-auto flex items-center gap-3 rounded-[var(--radius-card)] px-4 py-3 text-body-md text-white shadow-[var(--shadow-pop)]",
        kind === "error" ? "bg-danger" : kind === "success" ? "bg-success" : "bg-ink",
        className,
      )}
    >
      <div>
        <p>{message}</p>
        {description && <p className="text-body-sm opacity-90">{description}</p>}
      </div>
      {action && (
        <button type="button" className="font-semibold underline" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button type="button" aria-label="Dismiss" className="ml-2" onClick={onDismiss}>
          &times;
        </button>
      )}
    </div>
  );
}

export type ToasterProps = { position?: "bottom-center" | "top-center" };

export function Toaster({ position = "bottom-center" }: ToasterProps) {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <div
      aria-live="polite"
      role="status"
      className={cn("pointer-events-none fixed left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2", position === "bottom-center" ? "bottom-6" : "top-6")}
    >
      {list.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          kind={t.kind}
          description={t.description}
          action={t.action}
          onDismiss={() => dismiss(t.id)}
        />
      ))}
    </div>
  );
}
