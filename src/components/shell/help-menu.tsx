// OWNER: foundation-ui.
//
// HelpMenu (SPEC GEN-19, narrowed by docs/SCOPE.md): the sidebar "Help" flyout: "Help center" (the in-app how-to
// articles dialog, help-center.tsx), "What's new" (a static changelog dialog) and "Report a problem" (mailto the
// instance operator, MK-02). "Getting started" reopened the onboarding wizard, which docs/SCOPE.md does not build, so
// it is not offered. No keyboard shortcuts item (the app defines no global shortcuts).
"use client";

import { BookOpen, Bug, HelpCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Tooltip } from "../ui/tooltip";
import { HelpCenterDialog, reportProblemHref, WhatsNewDialog } from "./help-center";

export type HelpMenuProps = {
  /** Instance operator email for "Report a problem" (MK-02). */
  operatorEmail?: string | null;
  /** Icon-only trigger (collapsed sidebar rail). */
  collapsed?: boolean;
};

export function HelpMenu({ operatorEmail, collapsed }: HelpMenuProps) {
  const [helpCenter, setHelpCenter] = useState(false);
  const [whatsNew, setWhatsNew] = useState(false);
  const trigger = (
    <DropdownMenuTrigger
      aria-label={collapsed ? "Help" : undefined}
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-full px-3 text-[14px] font-semibold text-ink transition-colors hover:bg-pebble data-[state=open]:bg-pebble",
        collapsed && "justify-center px-0",
      )}
    >
      <HelpCircle aria-hidden="true" className="size-5 shrink-0 text-ink-2" />
      {!collapsed && <span className="truncate">Help</span>}
    </DropdownMenuTrigger>
  );
  return (
    <>
      <DropdownMenu>
        {collapsed ? (
          <Tooltip content="Help" side="right">
            {trigger}
          </Tooltip>
        ) : (
          trigger
        )}
        <DropdownMenuContent side="right" align="end" sideOffset={10} className="w-64">
          <DropdownMenuItem icon={<BookOpen aria-hidden="true" />} onSelect={() => setHelpCenter(true)}>
            Help center
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Sparkles aria-hidden="true" />} onSelect={() => setWhatsNew(true)}>
            What&apos;s new
          </DropdownMenuItem>
          {operatorEmail && (
            <DropdownMenuItem asChild>
              <a href={reportProblemHref(operatorEmail)}>
                <span className="inline-flex text-ink-2">
                  <Bug aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">Report a problem</span>
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <HelpCenterDialog open={helpCenter} onOpenChange={setHelpCenter} operatorEmail={operatorEmail} />
      <WhatsNewDialog open={whatsNew} onOpenChange={setWhatsNew} />
    </>
  );
}
