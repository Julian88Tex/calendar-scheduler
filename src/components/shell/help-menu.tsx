// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// HelpMenu (SPEC GEN-19): Help center, Getting started, What's new, Report a problem (no keyboard shortcuts item).
"use client";

import { HelpCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

export type HelpMenuProps = {
  /** Instance operator email for "Report a problem" (MK-02). */
  operatorEmail?: string | null;
  /** Icon-only trigger (collapsed sidebar rail). */
  collapsed?: boolean;
};

export function HelpMenu({ operatorEmail, collapsed }: HelpMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-full px-3 py-2 text-body-md text-ink hover:bg-pebble" aria-label={collapsed ? "Help" : undefined}>
        <HelpCircle aria-hidden="true" className="size-5" />
        {!collapsed && <span>Help</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end">
        <DropdownMenuItem href="/help">Help center</DropdownMenuItem>
        <DropdownMenuItem href="/onboarding">Getting started</DropdownMenuItem>
        <DropdownMenuItem href="/help">What&apos;s new</DropdownMenuItem>
        {operatorEmail && (
          <DropdownMenuItem asChild>
            <a href={`mailto:${operatorEmail}?subject=${encodeURIComponent("Report a problem")}`}>Report a problem</a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
