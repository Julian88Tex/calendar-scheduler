// OWNER: foundation-ui.
//
// CreateMenu (SPEC ET-02 narrowed by docs/SCOPE.md, GEN-20, walkthrough 6): the "+ Create" button (sidebar pill,
// collapsed-rail "+" circle, Scheduling header) opening a 360px menu with Calendly's two groups: "Event type" with
// "One-on-one" ("1 host -> 1 invitee" drawn with an arrow icon, "Good for coffee chats, 1:1 interviews, etc.") and
// "More ways to meet" with "Meeting poll" ("Let invitees vote on a time to meet"). docs/SCOPE.md keeps one-on-one
// event types and meeting polls only: Group, Round robin, Collective and One-off meeting are not built, so the menu
// offers no entry for them (and no "Where should this event type live?" step).
"use client";

import { ArrowRight, Plus } from "lucide-react";
import type { Route } from "next";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { buttonClassName } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Tooltip } from "../ui/tooltip";

export type CreateMenuTeam = { id: string; name: string };

/** Kept for compatibility with the original contract; multi-host event types are out of scope (docs/SCOPE.md). */
export type CreateMenuMultiHost = {
  /** Teams the user can manage (event types can live on their team page). */
  teams: CreateMenuTeam[];
  /** Whether the organization has members besides the user (shared multi-host types need someone to add). */
  hasOtherMembers: boolean;
  /** Owners and admins can invite people (the empty-workspace notice links to Invite users). */
  canInvite: boolean;
};

export type CreateMenuProps = {
  /** "full": the full-width sidebar pill; "compact": the "+" button of the collapsed rail; "header": a page header button. */
  variant?: "full" | "compact" | "header";
  align?: "start" | "center" | "end";
  className?: string;
  /** Ignored: multi-host event types are out of scope (docs/SCOPE.md). Kept so existing callers still compile. */
  multiHost?: CreateMenuMultiHost;
};

type Kind = "one_on_one" | "group" | "round_robin" | "collective";

/** The event type kinds the menu offers (docs/SCOPE.md: one-on-one only). */
const KINDS: { kind: Kind; title: string; from: string; to: string; description: string }[] = [
  { kind: "one_on_one", title: "One-on-one", from: "1 host", to: "1 invitee", description: "Good for coffee chats, 1:1 interviews, etc." },
];

const MORE: { href: Route; title: string; description: string }[] = [
  { href: "/app/polls/new", title: "Meeting poll", description: "Let invitees vote on a time to meet" },
];

const ITEM = "flex-col items-start gap-0.5 px-4 py-3";

function KindText({ title, from, to, description }: { title: string; from: string; to: string; description: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[14px] leading-5 font-bold text-ink">{title}</span>
      <span className="flex items-center gap-1 text-[12px] leading-4 font-semibold text-ink">
        {from}
        <ArrowRight aria-hidden="true" className="size-3 shrink-0" />
        <span className="sr-only">to</span>
        {to}
      </span>
      <span className="text-[12px] leading-4 text-ink-2">{description}</span>
    </span>
  );
}

/** The event type editor URL for a new event type of `kind` (/app/event-types/new?kind=one_on_one). */
export function eventTypeNewHref(kind: Kind, scope?: { scope: "shared" } | { scope: "team"; teamId: string }): Route {
  if (!scope) return `/app/event-types/new?kind=${kind}` as Route;
  if (scope.scope === "shared") return `/app/event-types/new?kind=${kind}&scope=shared` as Route;
  return `/app/event-types/new?kind=${kind}&scope=team&teamId=${encodeURIComponent(scope.teamId)}` as Route;
}

export function CreateMenu({ variant = "full", align = "start", className }: CreateMenuProps) {
  const trigger =
    variant === "compact" ? (
      <DropdownMenuTrigger
        aria-label="Create"
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-full border border-line-medium bg-white text-primary-text transition-colors hover:bg-primary-soft data-[state=open]:bg-primary-soft",
          className,
        )}
      >
        <Plus aria-hidden="true" className="size-5" />
      </DropdownMenuTrigger>
    ) : (
      <DropdownMenuTrigger
        className={cn(
          variant === "header"
            ? buttonClassName({ variant: "primary", size: "md" })
            : "inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-line-medium bg-white text-[14px] font-semibold text-primary-text transition-colors hover:bg-primary-soft data-[state=open]:bg-primary-soft",
          className,
        )}
      >
        <Plus aria-hidden="true" className="size-4" />
        <span>Create</span>
      </DropdownMenuTrigger>
    );

  return (
    <DropdownMenu>
      {variant === "compact" ? (
        <Tooltip content="Create" side="right">
          {trigger as React.ReactElement}
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align={align} side={variant === "compact" ? "right" : "bottom"} className="w-[360px] max-w-[calc(100vw-16px)] p-1.5">
        <DropdownMenuLabel className="px-4 pt-3">Event type</DropdownMenuLabel>
        {KINDS.map((k) => (
          <DropdownMenuItem key={k.kind} href={eventTypeNewHref(k.kind)} className={ITEM}>
            <KindText {...k} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuLabel className="px-4 pt-2">More ways to meet</DropdownMenuLabel>
        {MORE.map((m) => (
          <DropdownMenuItem key={m.href} href={m.href} className={ITEM}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[14px] leading-5 font-bold text-ink">{m.title}</span>
              <span className="text-[12px] leading-4 text-ink-2">{m.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
