// Owner tools on the host's own booking page (SPEC BK-24): "You are logged in as {email}. This message is only visible
// to you." with "Troubleshoot Availability" (in-page troubleshoot mode), "Edit event type" and "Copy link"; and the
// editor preview banner (ET-29). Client component.
"use client";

import { Check, Copy, Pencil, Stethoscope } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { toast } from "@/components/ui/toast";
import { useCopy } from "@/lib/client/use-copy";
import { cn } from "@/lib/cn";
import { bt } from "./lib/t";

const ACTION =
  "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-brand-strong transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&_svg]:size-4";

export type OwnerBannerProps = {
  email: string | null;
  troubleshooting: boolean;
  onToggleTroubleshoot: () => void;
  editUrl: string | null;
  canonicalUrl: string;
  inactive: boolean;
  className?: string;
};

export function OwnerBanner({ email, troubleshooting, onToggleTroubleshoot, editUrl, canonicalUrl, inactive, className }: OwnerBannerProps) {
  const { copy, copied } = useCopy();
  return (
    <div
      role="region"
      aria-label="Owner tools"
      data-testid="owner-banner"
      className={cn(
        "mx-auto mb-4 flex w-full max-w-[1060px] flex-col gap-2 border-line bg-white px-4 py-3 text-[13px] text-ink min-[600px]:rounded-[var(--radius-card)] min-[600px]:border min-[600px]:flex-row min-[600px]:items-center min-[600px]:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="min-w-0 break-words">{bt("owner.banner", { email: email ?? "" })}</p>
        {inactive && <p className="font-semibold text-warning-text">{bt("owner.inactive")}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <button type="button" onClick={onToggleTroubleshoot} aria-pressed={troubleshooting} className={ACTION}>
          <Stethoscope aria-hidden="true" />
          {troubleshooting ? bt("owner.stopTroubleshooting") : bt("owner.troubleshoot")}
        </button>
        {editUrl && (
          <Link href={editUrl as Route} className={ACTION}>
            <Pencil aria-hidden="true" />
            {bt("owner.edit")}
          </Link>
        )}
        <button type="button" onClick={() => void copy(canonicalUrl).then((ok) => ok && toast.success(bt("owner.copied")))} className={ACTION}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {bt("owner.copyLink")}
        </button>
      </div>
    </div>
  );
}

export function PreviewBanner({ canonicalUrl, hasPage }: { canonicalUrl: string; hasPage: boolean }) {
  return (
    <div role="status" data-testid="preview-banner" className="mx-auto mb-4 flex w-full max-w-[1060px] flex-wrap items-center justify-between gap-2 bg-ink px-4 py-3 text-[13px] text-white min-[600px]:rounded-[var(--radius-card)]">
      <span>{bt("preview.banner")}</span>
      {hasPage && (
        <a href={canonicalUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
          {bt("preview.viewPage")}
        </a>
      )}
    </div>
  );
}
