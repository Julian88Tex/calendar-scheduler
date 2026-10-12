// OWNER: foundation-ui.
//
// Toasts (ARCHITECTURE 20.2, SPEC GEN-12): toast("Changes saved"), toast.success(...), toast.error(...), toast.info(...),
// toast.dismiss(id?) from any client component; <Toaster /> (root layout) renders them bottom-center in an aria-live
// region (errors use role="alert"). A tiny module-level store; timers pause while the pointer is over a toast.
"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
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

const MAX_VISIBLE = 4;
let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const timers = new Map<string, { handle: ReturnType<typeof setTimeout> | null; duration: number }>();
let counter = 0;

function clearTimer(id: string) {
  const t = timers.get(id);
  if (t?.handle) clearTimeout(t.handle);
}

function schedule(id: string, duration: number) {
  clearTimer(id);
  if (!Number.isFinite(duration)) {
    timers.set(id, { handle: null, duration });
    return;
  }
  timers.set(id, { handle: setTimeout(() => dismiss(id), duration), duration });
}

function dismiss(id?: string): void {
  if (id) {
    clearTimer(id);
    timers.delete(id);
    items = items.filter((t) => t.id !== id);
  } else {
    for (const key of timers.keys()) clearTimer(key);
    timers.clear();
    items = [];
  }
  emit();
}

function show(message: React.ReactNode, opts: ToastOptions = {}): string {
  const id = opts.id ?? `toast-${++counter}`;
  const kind = opts.kind ?? "info";
  items = [...items.filter((t) => t.id !== id), { id, message, kind, description: opts.description, action: opts.action }].slice(-MAX_VISIBLE);
  emit();
  schedule(id, opts.durationMs ?? (kind === "error" ? 6000 : 4000));
  return id;
}

/** Pauses (pointer over the toast) and resumes (pointer left) the auto-dismiss timer. */
function pause(id: string) {
  clearTimer(id);
}
function resume(id: string) {
  const t = timers.get(id);
  if (t) schedule(id, Math.min(t.duration, 2500));
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

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info } as const;
const ICON_COLORS = { success: "text-[#70e1ac]", error: "text-[#ff906b]", info: "text-[#8cc6fd]" } as const;

/** One toast (rendered by <Toaster />; also usable inline, for example on /app/dev/ui). */
export function Toast({ message, kind = "info", description, action, onDismiss, className }: ToastProps) {
  const Icon = ICONS[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full max-w-[min(440px,calc(100vw-32px))] min-w-0 items-start gap-3 rounded-[var(--radius-card)] bg-[#0a2540] px-4 py-3 text-[14px] leading-5 text-white shadow-[var(--shadow-pop)] sm:min-w-80",
        "animate-toast-in",
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-px size-5 shrink-0", ICON_COLORS[kind])} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold break-words">{message}</p>
        {description && <p className="mt-0.5 text-[13px] break-words text-white/85">{description}</p>}
      </div>
      {action && (
        <button
          type="button"
          className="shrink-0 rounded-full px-2 py-0.5 font-semibold text-[#8cc6fd] underline-offset-2 hover:underline focus-visible:outline-white"
          onClick={() => {
            action.onClick();
            onDismiss?.();
          }}
        >
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-white"
          onClick={onDismiss}
        >
          <X aria-hidden="true" className="size-4" />
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
      aria-label="Notifications"
      role="region"
      className={cn(
        "pointer-events-none fixed inset-x-0 z-[80] flex flex-col items-center gap-2 px-4",
        position === "bottom-center" ? "bottom-6" : "top-6",
      )}
    >
      {list.map((t) => (
        <div key={t.id} className="flex w-full justify-center" onMouseEnter={() => pause(t.id)} onMouseLeave={() => resume(t.id)}>
          <Toast message={t.message} kind={t.kind} description={t.description} action={t.action} onDismiss={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
