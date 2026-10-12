// OWNER: conferencing.
//
// Shows the result of a Google Calendar connect flow on the Google Meet page once: a "Google Calendar connected" toast
// for success, dismissible banners for problems. The query parameters are then removed from the address bar, so a
// reload or a shared link does not repeat them (the Google Calendar page behaves the same way).
"use client";

import { useEffect, useRef } from "react";
import { Banner } from "@/components/ui/banner";
import { toast } from "@/components/ui/toast";
import { MEET_NOTICE_PARAMS, type MeetNotice } from "./notices";

export function MeetConnectNotices({ notices }: { notices: MeetNotice[] }) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    for (const n of notices) if (n.tone === "success") toast.success(n.message);
    try {
      const url = new URL(window.location.href);
      let changed = false;
      for (const k of MEET_NOTICE_PARAMS) {
        if (url.searchParams.has(k)) {
          url.searchParams.delete(k);
          changed = true;
        }
      }
      if (changed) window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // cosmetic only
    }
  }, [notices]);
  const banners = notices.filter((n) => n.tone !== "success");
  if (!banners.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {banners.map((n) => (
        <Banner key={n.message} variant={n.tone === "error" ? "error" : "warning"} dismissible>
          {n.message}
        </Banner>
      ))}
    </div>
  );
}
