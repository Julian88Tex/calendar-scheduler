// Auto-save plumbing of the Schedules tab (SPEC AV-10): a serial queue per page (saves run one after another, in the
// order the edits happened), the inline "Saving..." / "Saved" indicator, and the shared failure copy.
"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";

export const SAVE_FAILED = "Couldn't save your changes. Try again.";

export type SaveState = "idle" | "saving" | "saved";

/** Runs saves serially and reports the combined state ("Saved" stays visible for 2.5 seconds). */
export function useSaveQueue() {
  const [state, setState] = useState<SaveState>("idle");
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped by every edit; a save only reports "Saved" when no edit happened after it started. */
  const editVersion = useRef(0);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  const run = useCallback(<T,>(task: () => Promise<T>, opts: { silent?: boolean } = {}): Promise<T> => {
    inFlight.current += 1;
    const version = editVersion.current;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setState("saving");
    const p = queue.current.then(task, task);
    queue.current = p.catch(() => undefined);
    const settle = (ok: boolean) => {
      inFlight.current -= 1;
      if (inFlight.current > 0) return;
      if (ok && !opts.silent && version === editVersion.current) {
        setState("saved");
        hideTimer.current = setTimeout(() => setState("idle"), 2500);
      } else setState("idle");
    };
    p.then(
      (v) => settle(Boolean(v && typeof v === "object" && "ok" in v ? (v as { ok: boolean }).ok : true)),
      () => settle(false),
    );
    return p;
  }, []);

  /** Resolves once every queued save finished. */
  const idle = useCallback(() => queue.current.then(() => undefined), []);

  /** A new edit is pending: hide "Saved" until it is saved too (the indicator always reflects the latest edit). */
  const markDirty = useCallback(() => {
    editVersion.current += 1;
    if (inFlight.current > 0) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setState("idle");
  }, []);

  return { state, run, idle, markDirty };
}

export function SaveIndicator({ state, className }: { state: SaveState; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex min-h-6 items-center gap-1.5 text-body-sm font-semibold", className)}>
      {state === "saving" && (
        <>
          <Spinner size="sm" decorative />
          <span className="text-ink-2">Saving...</span>
        </>
      )}
      {state === "saved" && (
        <>
          <Check aria-hidden="true" className="size-4 text-success" />
          <span className="text-success-text">Saved</span>
        </>
      )}
    </span>
  );
}
