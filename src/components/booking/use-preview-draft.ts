// Event type editor live preview (SPEC ET-29, ARCHITECTURE 17.1): with ?preview=1 for an editor of the event type, the
// booking page listens for `{ type: "kairos:preview", draft }` messages from its own origin, renders the draft over the
// saved data and replies `{ type: "kairos:preview_ready" }` once mounted. Client only.
"use client";

import { useEffect, useState } from "react";
import type { EventTypePreviewDraft } from "@/db/types";
import { toPublicLocations } from "./lib/locations";
import type { EventView } from "./types";

function isDraft(v: unknown): v is EventTypePreviewDraft {
  if (!v || typeof v !== "object") return false;
  const d = v as Partial<EventTypePreviewDraft>;
  return typeof d.name === "string" && typeof d.durationMinutes === "number" && Array.isArray(d.locations);
}

export function usePreviewDraft(enabled: boolean): EventTypePreviewDraft | null {
  const [draft, setDraft] = useState<EventTypePreviewDraft | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: unknown; draft?: unknown } | null;
      if (data?.type === "kairos:preview" && isDraft(data.draft)) setDraft(data.draft);
    };
    window.addEventListener("message", onMessage);
    try {
      if (window.parent !== window) window.parent.postMessage({ type: "kairos:preview_ready" }, window.location.origin);
    } catch {
      // the editor is gone
    }
    return () => window.removeEventListener("message", onMessage);
  }, [enabled]);
  return draft;
}

/** Plain text of draft HTML (previews never inject unsanitized markup). */
export function draftText(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

const clampDuration = (n: unknown): number | null => (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 720 ? n : null);

/** The event view with the draft's fields applied (name, durations, locations, description, seats, locked zone). */
export function applyDraft(event: EventView, draft: EventTypePreviewDraft | null): EventView {
  if (!draft) return event;
  const def = clampDuration(draft.durationMinutes) ?? event.defaultDuration;
  const options = (draft.durationOptions ?? []).map(clampDuration).filter((d): d is number => d !== null);
  const durations = [def, ...options.filter((d) => d !== def)].filter((d, i, a) => a.indexOf(d) === i);
  return {
    ...event,
    name: draft.name,
    color: draft.color || event.color,
    kind: draft.kind === "group" ? "group" : "solo",
    durations,
    defaultDuration: def,
    descriptionHtml: null,
    descriptionText: draftText(draft.descriptionHtml),
    locations: toPublicLocations(draft.locations),
    showRemainingSpots: draft.kind === "group" && draft.showRemainingSpots,
    lockedTimeZone: draft.timeZoneDisplay === "locked" && draft.lockedTimeZone ? draft.lockedTimeZone : null,
  };
}
