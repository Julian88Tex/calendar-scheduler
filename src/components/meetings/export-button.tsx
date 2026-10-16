// "Export" of the Meetings page (SPEC MT-11): downloads the CSV of the current tab and filters. A plain download link
// that, with JavaScript, fetches the file first so a refusal (signed out, too many exports) shows as a toast instead of
// a downloaded error page, with a busy state while the file is built. Client component.
"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { buttonClassName } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { MEETINGS_COPY as C } from "@/lib/meetings/copy";

function filenameOf(disposition: string | null): string {
  const m = /filename="([^"]+)"/.exec(disposition ?? "");
  return m?.[1] ?? "meetings.csv";
}

export function ExportButton({ href }: { href: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <a
      href={href}
      download
      aria-label={C.exportLabel}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      className={buttonClassName({ variant: "secondary", size: "sm" })}
      data-testid="meetings-export"
      onClick={async (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          const res = await fetch(href, { credentials: "same-origin", headers: { Accept: "text/csv" } });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { message?: string } | null;
            toast.error(body?.message || C.errors.generic);
            return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filenameOf(res.headers.get("content-disposition"));
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        } catch {
          toast.error(C.errors.network);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner size="sm" inheritColor decorative /> : <Download aria-hidden="true" />}
      {C.export}
    </a>
  );
}
