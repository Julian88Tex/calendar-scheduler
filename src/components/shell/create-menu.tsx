// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// CreateMenu (SPEC ET-02, GEN-20): the "+ Create" pill (sidebar, Scheduling header) listing event type kinds, one-off
// meeting and meeting poll.
"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";

export type CreateMenuProps = {
  /** "full": the full-width sidebar pill; "compact": the "+" button of the collapsed rail; "header": a page header button. */
  variant?: "full" | "compact" | "header";
  align?: "start" | "center" | "end";
  className?: string;
};

export function CreateMenu({ variant = "full", align = "start", className }: CreateMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={variant === "compact" ? "Create" : undefined}
        className={cn("inline-flex items-center justify-center gap-2 rounded-full border border-line font-semibold text-ink", variant === "full" ? "h-10 w-full" : variant === "compact" ? "size-10" : "h-10 px-4", className)}
      >
        <Plus aria-hidden="true" className="size-4" />
        {variant !== "compact" && <span>Create</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuLabel>Event type</DropdownMenuLabel>
        <DropdownMenuItem href="/app/event-types/new?kind=one_on_one">One-on-one</DropdownMenuItem>
        <DropdownMenuItem href="/app/event-types/new?kind=group">Group</DropdownMenuItem>
        <DropdownMenuItem href="/app/event-types/new?kind=round_robin">Round robin</DropdownMenuItem>
        <DropdownMenuItem href="/app/event-types/new?kind=collective">Collective</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>More ways to meet</DropdownMenuLabel>
        <DropdownMenuItem href="/app/one-off/new">One-off meeting</DropdownMenuItem>
        <DropdownMenuItem href="/app/polls/new">Meeting poll</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
