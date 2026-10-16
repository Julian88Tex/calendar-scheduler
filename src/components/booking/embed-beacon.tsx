// Embed messages of server-rendered public pages (SPEC BK-25, API-15): posts one calendly.* event to the parent window
// on load and keeps calendly.page_height up to date for `data-resize="true"` inline embeds. Renders nothing; no-op
// outside iframes. Client component.
"use client";

import { useEffect } from "react";
import { postEmbedEvent, postPageHeight, type EmbedEventName } from "@/lib/embed-events";

export function EmbedBeacon({ event, payload }: { event?: EmbedEventName; payload?: Record<string, unknown> }) {
  useEffect(() => {
    if (event) postEmbedEvent(event, payload ?? {});
    // Only once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => postPageHeight());
    ro.observe(document.documentElement);
    postPageHeight();
    return () => ro.disconnect();
  }, []);
  return null;
}
