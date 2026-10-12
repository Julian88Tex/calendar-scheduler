// Live preview of the booking page (SPEC ET-29, ARCHITECTURE 17.1): an iframe of /{handle}/{eventSlug}?preview=1 (or
// /{handle}/__preview__?preview=1 for an unsaved type) on the #FAFAFA canvas. The unsaved draft is posted with
// postMessage({ type: "kairos:preview", draft }) to the same origin, debounced 150ms, and again whenever the page
// answers { type: "kairos:preview_ready" } (first load, reloads). Wide pages are scaled down to fit the pane so the
// desktop layout stays visible. Client component.
"use client";

import { Info } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import type { EventTypePreviewDraft } from "@/db/types";
import { cn } from "@/lib/cn";

/** Natural width of the desktop booking card layout (the card grows to 1060px when a date is selected). */
const DESKTOP_WIDTH = 1100;
/** Below this scale the iframe renders at the pane width instead (the booking page's own narrow layout). */
const MIN_SCALE = 0.62;
const DEBOUNCE_MS = 150;

function useFrameScale(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [box, setBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);
  if (!box.width) return { scale: 1, width: "100%", height: "100%" } as const;
  const s = box.width / DESKTOP_WIDTH;
  if (s >= 1 || s < MIN_SCALE) return { scale: 1, width: "100%", height: "100%" } as const;
  return { scale: s, width: `${DESKTOP_WIDTH}px`, height: `${box.height / s}px` } as const;
}

export type PreviewPaneProps = {
  previewPath: string | null;
  draft: EventTypePreviewDraft;
  /** Unsaved availability changes (the calendar shows saved availability). */
  availabilityDirty: boolean;
  /** Changing it reloads the frame (after a save). */
  reloadKey: number;
  className?: string;
  /** Scale the desktop layout to fit (side pane); false renders at the pane width (phone preview). */
  scaled?: boolean;
  /**
   * False while the pane is hidden (phones before "Preview" is tapped): the booking page and its availability requests
   * are not loaded until the preview is first shown, then the frame stays mounted.
   */
  active?: boolean;
};

export function PreviewPane({ previewPath, draft, availabilityDirty, reloadKey, className, scaled = true, active = true }: PreviewPaneProps) {
  const [mounted, setMounted] = useState(active);
  if (active && !mounted) setMounted(true);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const latest = useRef(draft);
  const frameKey = `${previewPath ?? ""}:${reloadKey}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loaded = loadedKey === frameKey;
  const setLoaded = useCallback(() => setLoadedKey(frameKey), [frameKey]);
  const fit = useFrameScale(box, scaled);

  useEffect(() => {
    latest.current = draft;
  }, [draft]);

  const post = useCallback(() => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage({ type: "kairos:preview", draft: latest.current }, window.location.origin);
    } catch {
      // the frame navigated away
    }
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const data = e.data as { type?: unknown } | null;
      if (data?.type === "kairos:preview_ready") {
        setLoaded();
        post();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [post, setLoaded]);

  useEffect(() => {
    const id = setTimeout(post, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [draft, post]);

  // The frame may finish loading before this component hydrates (its load event and first ready message are then
  // missed): pick up an already loaded document. A later ready message posts the draft again.
  useEffect(() => {
    const doc = (() => {
      try {
        return frame.current?.contentDocument ?? null;
      } catch {
        return null;
      }
    })();
    if (doc && doc.readyState === "complete" && doc.URL !== "about:blank") {
      setLoaded();
      post();
    }
  }, [frameKey, post, setLoaded]);

  return (
    <div className={cn("relative flex min-h-0 min-w-0 flex-col bg-canvas", className)}>
      {availabilityDirty && (
        <div role="status" className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-body-sm font-semibold text-white shadow-[var(--shadow-pop)]">
          <Info aria-hidden="true" className="size-4" />
          Save to update availability
        </div>
      )}
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden">
        {!mounted ? null : previewPath ? (
          <>
            {!loaded && (
              <div aria-hidden="true" className="absolute inset-0 flex items-start justify-center p-10">
                <div className="h-[520px] w-full max-w-[800px] animate-pulse rounded-[var(--radius-card)] border border-line bg-white" />
              </div>
            )}
            <iframe
              key={frameKey}
              ref={frame}
              src={previewPath}
              title="Booking page preview"
              onLoad={() => {
                setLoaded();
                post();
              }}
              className={cn("absolute top-0 left-0 origin-top-left border-0 bg-transparent transition-opacity", loaded ? "opacity-100" : "opacity-0")}
              style={{ width: fit.width, height: fit.height, transform: fit.scale === 1 ? undefined : `scale(${fit.scale})` }}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div className="max-w-sm">
              <p className="text-title-sm text-ink">Preview unavailable</p>
              <p className="mt-1 text-body-md text-ink-2">Choose your scheduling link in Settings to preview your booking page here.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
