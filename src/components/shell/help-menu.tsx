// OWNER: foundation-ui.
//
// HelpMenu (SPEC GEN-19): the sidebar "Help" flyout: "Help center" (/help), "Getting started" (reopens the onboarding
// wizard), "What's new" (a static changelog dialog) and "Report a problem" (mailto the instance operator, MK-02). No
// keyboard shortcuts item (the app defines no global shortcuts).
"use client";

import { BookOpen, Bug, HelpCircle, Rocket, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { APP_NAME } from "@/lib/brand";
import { Dialog } from "../ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Tooltip } from "../ui/tooltip";

export type HelpMenuProps = {
  /** Instance operator email for "Report a problem" (MK-02). */
  operatorEmail?: string | null;
  /** Icon-only trigger (collapsed sidebar rail). */
  collapsed?: boolean;
};

const CHANGELOG: { title: string; items: string[] }[] = [
  {
    title: "Scheduling",
    items: [
      "One-on-one, group, round robin and collective event types with a live booking page preview.",
      "Single-use links, one-off meetings and meeting polls for finding a time with a group.",
      "Routing forms that send visitors to the right event type, a message or a URL.",
    ],
  },
  {
    title: "Availability and calendars",
    items: [
      "Schedules with weekly hours, date-specific hours and holidays by country.",
      "Google, Outlook, iCloud, CalDAV and ICS feed calendars checked for conflicts.",
      "Zoom, Google Meet, Microsoft Teams and Jitsi meeting links.",
    ],
  },
  {
    title: "Automation and insights",
    items: [
      "Workflows for email and text reminders, follow-ups and webhooks.",
      "Analytics for bookings, cancellations, popular times and routing.",
      "A REST API, webhooks and website embeds for your own integrations.",
    ],
  },
];

export function HelpMenu({ operatorEmail, collapsed }: HelpMenuProps) {
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
          <DropdownMenuItem href="/help" icon={<BookOpen aria-hidden="true" />}>
            Help center
          </DropdownMenuItem>
          <DropdownMenuItem href="/onboarding" icon={<Rocket aria-hidden="true" />}>
            Getting started
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Sparkles aria-hidden="true" />} onSelect={() => setWhatsNew(true)}>
            What&apos;s new
          </DropdownMenuItem>
          {operatorEmail && (
            <DropdownMenuItem asChild>
              <a href={`mailto:${operatorEmail}?subject=${encodeURIComponent(`Report a problem with ${APP_NAME}`)}`}>
                <span className="inline-flex text-ink-2">
                  <Bug aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">Report a problem</span>
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={whatsNew} onOpenChange={setWhatsNew} title="What's new" description={`Recent improvements to ${APP_NAME}.`} size="md">
        <div className="flex flex-col gap-5">
          {CHANGELOG.map((section) => (
            <section key={section.title}>
              <h3 className="text-title-sm text-ink">{section.title}</h3>
              <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-body-md text-ink">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Dialog>
    </>
  );
}
