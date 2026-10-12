// OWNER: calendar-integrations.
//
// Shows the result of a connect flow once (a toast for success, banners for problems) and removes the query
// parameters from the address bar so a reload does not repeat it.
"use client";

import { useEffect, useRef } from "react";
import { Banner } from "@/components/ui/banner";
import { toast } from "@/components/ui/toast";
import { NOTICE_PARAMS, type CalendarNotice } from "./notices";

export function ConnectNotices({ notices }: { notices: CalendarNotice[] }) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    for (const n of notices) if (n.tone === "success") toast.success(n.message);
    try {
      const url = new URL(window.location.href);
      let changed = false;
      for (const k of NOTICE_PARAMS) {
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
    <div className="flex max-w-[880px] flex-col gap-3">
      {banners.map((n) => (
        <Banner key={n.message} variant={n.tone === "error" ? "error" : "warning"} dismissible>
          {n.message}
        </Banner>
      ))}
    </div>
  );
}
