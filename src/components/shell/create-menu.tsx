// OWNER: foundation-ui.
//
// CreateMenu (SPEC ET-02, GEN-20, walkthrough 6): the "+ Create" button (sidebar pill, collapsed-rail "+" circle,
// Scheduling header) opening a 360px menu with two groups: "Event type" (One-on-one, Group, Round robin, Collective,
// each with its "1 host -> 1 invitee" line drawn with an arrow icon and a description) and "More ways to meet"
// (One-off meeting, Meeting poll). Round robin and Collective first ask "Where should this event type live?":
// "Shared (no team page)" or a team the user manages; with no teams and no other members a notice offers "Invite
// users". Without `multiHost` data the multi-host kinds link straight to the editor.
"use client";

import { ArrowLeft, ArrowRight, Plus, Users } from "lucide-react";
import type { Route } from "next";
import { useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { buttonClassName } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Tooltip } from "../ui/tooltip";

export type CreateMenuTeam = { id: string; name: string };

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
  /** Teams and members for the Round robin and Collective "Where should this event type live?" step. */
  multiHost?: CreateMenuMultiHost;
};

type Kind = "one_on_one" | "group" | "round_robin" | "collective";

const KINDS: { kind: Kind; title: string; from: string; to: string; description: string }[] = [
  { kind: "one_on_one", title: "One-on-one", from: "1 host", to: "1 invitee", description: "Good for coffee chats, 1:1 interviews, etc." },
  { kind: "group", title: "Group", from: "1 host", to: "Multiple invitees", description: "Webinars, online classes, etc." },
  { kind: "round_robin", title: "Round robin", from: "Rotating hosts", to: "1 invitee", description: "Distribute meetings between team members" },
  { kind: "collective", title: "Collective", from: "Multiple hosts", to: "1 invitee", description: "Panel interviews, group sales calls, etc." },
];

const MORE: { href: Route; title: string; description: string }[] = [
  { href: "/app/one-off/new", title: "One-off meeting", description: "Offer time outside your normal schedule" },
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

export function eventTypeNewHref(kind: Kind, scope?: { scope: "shared" } | { scope: "team"; teamId: string }): Route {
  if (!scope) return `/app/event-types/new?kind=${kind}` as Route;
  if (scope.scope === "shared") return `/app/event-types/new?kind=${kind}&scope=shared` as Route;
  return `/app/event-types/new?kind=${kind}&scope=team&teamId=${encodeURIComponent(scope.teamId)}` as Route;
}

export function CreateMenu({ variant = "full", align = "start", className, multiHost }: CreateMenuProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<null | "round_robin" | "collective">(null);

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

  const kind = step ? KINDS.find((k) => k.kind === step)! : null;
  const noTeams = multiHost ? multiHost.teams.length === 0 : false;
  const emptyWorkspace = multiHost ? noTeams && !multiHost.hasOtherMembers : false;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setStep(null);
      }}
    >
      {variant === "compact" ? (
        <Tooltip content="Create" side="right">
          {trigger as React.ReactElement}
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align={align} side={variant === "compact" ? "right" : "bottom"} className="w-[360px] max-w-[calc(100vw-16px)] p-1.5">
        {!kind ? (
          <>
            <DropdownMenuLabel className="px-4 pt-3">Event type</DropdownMenuLabel>
            {KINDS.map((k) => {
              const multi = k.kind === "round_robin" || k.kind === "collective";
              if (multi && multiHost) {
                return (
                  <DropdownMenuItem
                    key={k.kind}
                    className={ITEM}
                    onSelect={(e) => {
                      e.preventDefault();
                      setStep(k.kind as "round_robin" | "collective");
                    }}
                  >
                    <KindText {...k} />
                  </DropdownMenuItem>
                );
              }
              return (
                <DropdownMenuItem key={k.kind} href={eventTypeNewHref(k.kind)} className={ITEM}>
                  <KindText {...k} />
                </DropdownMenuItem>
              );
            })}
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
          </>
        ) : (
          <>
            <DropdownMenuItem
              className="gap-2 px-3 text-primary-text"
              onSelect={(e) => {
                e.preventDefault();
                setStep(null);
              }}
            >
              <ArrowLeft aria-hidden="true" className="text-primary-text" />
              <span className="font-semibold text-primary-text">Back</span>
            </DropdownMenuItem>
            <div className="px-4 pt-2 pb-1">
              <p className="text-[14px] leading-5 font-bold text-ink">Where should this event type live?</p>
              <p className="mt-0.5 text-[12px] leading-4 text-ink-2">{kind.title} event types need more than one host.</p>
            </div>
            {emptyWorkspace ? (
              <div className="mx-2 mt-2 mb-2 flex flex-col gap-3 rounded-[var(--radius-card)] bg-primary-soft p-4">
                <p className="flex items-start gap-2 text-[14px] leading-5 text-ink">
                  <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary-text" />
                  Invite people to your workspace to create multi-host event types.
                </p>
                {multiHost?.canInvite ? (
                  <DropdownMenuItem href="/app/admin/people?invite=1" className={cn(buttonClassName({ variant: "primary", size: "sm" }), "w-fit data-[highlighted]:bg-primary-hover")}>
                    Invite users
                  </DropdownMenuItem>
                ) : (
                  <p className="text-[12px] leading-4 text-ink-2">Ask an admin of your workspace to invite people.</p>
                )}
              </div>
            ) : (
              <>
                <DropdownMenuItem href={eventTypeNewHref(kind.kind, { scope: "shared" })} className={ITEM}>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[14px] leading-5 font-bold text-ink">Shared (no team page)</span>
                    <span className="text-[12px] leading-4 text-ink-2">Pick hosts from your workspace; it has no team landing page.</span>
                  </span>
                </DropdownMenuItem>
                {(multiHost?.teams ?? []).map((t) => (
                  <DropdownMenuItem key={t.id} href={eventTypeNewHref(kind.kind, { scope: "team", teamId: t.id })} className={ITEM}>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[14px] leading-5 font-bold text-ink">{t.name}</span>
                      <span className="text-[12px] leading-4 text-ink-2">Listed on the team page</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
