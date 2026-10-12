// OWNER: foundation-ui.
//
// SectionCard (ARCHITECTURE 20.2, walkthrough 7.1): the event type editor's collapsible section row: icon, bold title,
// a one-line gray summary of the current value while collapsed, an optional badge, a lock for admin-locked sections and
// a chevron. Controlled (open + onOpenChange) or uncontrolled (defaultOpen). Radix Collapsible: the header is a button
// with aria-expanded and aria-controls.
"use client";

import * as RadixCollapsible from "@radix-ui/react-collapsible";
import { ChevronDown, Lock } from "lucide-react";
import { useState } from "react";
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
  const [inner, setInner] = useState(defaultOpen ?? false);
  const isOpen = open ?? inner;
  return (
    <RadixCollapsible.Root
      id={id}
      open={isOpen}
      disabled={disabled}
      onOpenChange={(v) => {
        if (open === undefined) setInner(v);
        onOpenChange?.(v);
      }}
      className={cn("min-w-0 rounded-[var(--radius-card)] border border-line bg-white", disabled && "opacity-60", className)}
    >
      <RadixCollapsible.Trigger
        className={cn(
          "flex w-full items-start gap-3 rounded-[var(--radius-card)] px-4 py-4 text-left transition-colors duration-100 sm:px-5",
          "hover:bg-cloud disabled:cursor-not-allowed disabled:hover:bg-transparent",
          isOpen && "rounded-b-none",
        )}
      >
        {icon && <span className="mt-0.5 inline-flex shrink-0 text-ink-2 [&_svg]:size-5">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-title-sm text-ink">{title}</span>
            {badge}
            {locked && (
              <span className="inline-flex items-center gap-1 text-body-sm font-semibold text-ink-2">
                <Lock aria-hidden="true" className="size-3.5" />
                Locked
              </span>
            )}
          </span>
          {summary && !isOpen && <span className="mt-0.5 block truncate text-body-md text-ink-2">{summary}</span>}
        </span>
        <ChevronDown aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0 text-ink-2 transition-transform duration-150", isOpen && "rotate-180")} />
      </RadixCollapsible.Trigger>
      <RadixCollapsible.Content className="border-t border-line px-4 py-5 sm:px-5">
        <fieldset disabled={locked} className="min-w-0">
          {children}
        </fieldset>
      </RadixCollapsible.Content>
    </RadixCollapsible.Root>
  );
}
