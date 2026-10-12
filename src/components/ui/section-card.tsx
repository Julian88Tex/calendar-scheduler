// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// SectionCard (ARCHITECTURE 20.2): collapsible section row with icon, title, summary and chevron (event type editor
// accordion sections). Foundation stub: a native <details>.
"use client";

import type * as React from "react";
import { cn } from "@/lib/cn";

export type SectionCardProps = {
  title: React.ReactNode;
  icon?: React.ReactNode;
  /** One line shown under the title while collapsed ("30 min, Google Meet"). */
  summary?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  badge?: React.ReactNode;
  /** Managed event sections locked by an admin show a lock and are read only. */
  locked?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  children: React.ReactNode;
};

export function SectionCard({ title, icon, summary, open, defaultOpen, onOpenChange, badge, locked, disabled, id, className, children }: SectionCardProps) {
  return (
    <details
      id={id}
      open={open ?? defaultOpen}
      onToggle={(e) => onOpenChange?.((e.currentTarget as HTMLDetailsElement).open)}
      className={cn("rounded-[var(--radius-card)] border border-line bg-white", disabled && "opacity-60", className)}
    >
      <summary className="flex cursor-pointer items-center gap-3 p-4">
        {icon}
        <span className="flex-1">
          <span className="block text-title-sm">{title}</span>
          {summary && <span className="block text-body-sm text-ink-2">{summary}</span>}
        </span>
        {badge}
        {locked && <span className="text-body-sm text-ink-2">Locked</span>}
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}
