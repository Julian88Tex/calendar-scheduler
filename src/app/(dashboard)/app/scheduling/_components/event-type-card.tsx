// Event type row card of the Scheduling page (SPEC ET-04, ET-05, ET-07, ET-08, ET-09, ET-10; walkthrough 5.1):
// full-width white card with a 1px #D4E0ED border, 8px radius and a 6px strip in the event color on the left; the
// drag handle (on hover or focus, desktop) and the bulk select checkbox; the bold event name (a link to the editor)
// with the slashed eye when secret and a gray "Off" badge plus 50% text opacity when turned off; the meta line
// "30 min, Google Meet, One-on-One", the availability summary, the internal note and "View booking page"; on the
// right "Copy link" ("Copied" for 2 seconds, "Link copied" toast), the share icon and the kebab menu. Clicking the card
// outside its controls opens the editor. Docs/SCOPE.md skips the hover quick actions (single-use links, offered times,
// shared availability, booking on behalf). Client component.
"use client";

import { EyeOff, GripVertical, Share2, StickyNote } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { EventTypeListItem } from "@/lib/event-types/types";
import { CardMenu } from "./card-menu";
import { metaLine } from "./list-text";

export type EventTypeCardProps = {
  item: EventTypeListItem;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  busy: boolean;
  /** Reorder handle props, or null when reordering is off (search or filters active, a single card). */
  handle: React.ComponentProps<"button"> | null;
  lifted: boolean;
  dragging: boolean;
  dropIndicator: "before" | "after" | null;
  highlight: boolean;
  rowProps: React.ComponentProps<"li"> & { ref?: (el: HTMLElement | null) => void };
  onShare: (trigger: HTMLElement) => void;
  onNote: () => void;
  onSecret: (secret: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onActive: (active: boolean) => void;
};

/** Clicks on these (and inside portaled menus or dialogs) never open the editor. */
const INTERACTIVE = "a,button,input,textarea,select,label,[role=checkbox],[role=menuitem],[role=menuitemcheckbox],[data-no-card-click]";

export function EventTypeCard(p: EventTypeCardProps) {
  const { item } = p;
  const router = useRouter();
  const editHref = `/app/event-types/${item.id}` as Route;
  const nameId = `et-name-${item.id}`;

  const openEditor = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target as Element;
    if (!e.currentTarget.contains(target) || target.closest(INTERACTIVE)) return;
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    router.push(editHref);
  };

  return (
    <li
      {...p.rowProps}
      aria-labelledby={nameId}
      className={cn("relative", p.dragging && "opacity-60")}
      data-testid="event-type-card"
      data-event-type-id={item.id}
    >
      {p.dropIndicator === "before" && <span aria-hidden="true" className="absolute inset-x-0 -top-2 h-0.5 rounded-full bg-primary" />}
      {p.dropIndicator === "after" && <span aria-hidden="true" className="absolute inset-x-0 -bottom-2 h-0.5 rounded-full bg-primary" />}
      <div
        onClick={openEditor}
        className={cn(
          "group relative flex min-w-0 cursor-pointer overflow-hidden rounded-[var(--radius-card)] border bg-white transition-[border-color,box-shadow] duration-100",
          "hover:border-line-medium hover:shadow-[var(--shadow-next)]",
          p.selected ? "border-primary" : "border-line",
          p.lifted && "border-primary shadow-[var(--shadow-pop)] outline-2 outline-offset-2 outline-focus",
          p.highlight && "outline-2 outline-offset-2 outline-focus",
        )}
      >
        <span aria-hidden="true" className={cn("w-1.5 shrink-0", !item.active && "opacity-40 grayscale")} style={{ backgroundColor: item.color }} />
        <div className="flex min-w-0 flex-1 items-start gap-2 py-4 pr-3 pl-2 sm:gap-3 sm:py-5 sm:pr-5 sm:pl-3">
          <div className="flex shrink-0 items-center gap-0.5 sm:-ml-1">
            {p.handle && (
              <button
                {...p.handle}
                className={cn(
                  "hidden size-8 shrink-0 cursor-grab items-center justify-center rounded-full text-ink-2 transition-[opacity,background-color] sm:inline-flex",
                  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-primary-soft hover:text-primary-text active:cursor-grabbing",
                  "aria-pressed:bg-primary-soft aria-pressed:text-primary-text aria-pressed:opacity-100",
                )}
              >
                <GripVertical aria-hidden="true" className="size-4" />
              </button>
            )}
            <span className="inline-flex size-8 items-center justify-center" data-no-card-click>
              <Checkbox checked={p.selected} onCheckedChange={p.onSelectedChange} aria-label={`Select ${item.name}`} />
            </span>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h3 id={nameId} className={cn("min-w-0 text-title-sm break-words sm:text-title-md", item.active ? "text-ink" : "text-ink-2")}>
                  <Link href={editHref} className="rounded-[2px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                    {item.name}
                  </Link>
                </h3>
                {item.secret && (
                  <span role="img" aria-label="Secret event type" title="Secret: hidden from your landing page" className="inline-flex text-ink-2">
                    <EyeOff aria-hidden="true" className="size-4" />
                  </span>
                )}
                {!item.active && (
                  <Badge variant="neutral" size="md">
                    Off
                  </Badge>
                )}
              </div>
              <p className="text-body-md text-ink-2">{metaLine(item)}</p>
              <p className="text-body-md text-ink-2">{item.availabilitySummary}</p>
              {item.internalNote && (
                <p className="mt-1 flex min-w-0 items-start gap-1.5 text-body-sm text-ink-2">
                  <StickyNote aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                  <span className="line-clamp-2 break-words">
                    <span className="sr-only">Internal note: </span>
                    {item.internalNote}
                  </span>
                </p>
              )}
              {item.publicUrl && (
                <a
                  href={item.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View booking page for ${item.name}`}
                  className="mt-1 w-fit rounded-[2px] text-body-md font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  View booking page
                </a>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1" data-no-card-click>
              {item.publicUrl && <CopyButton value={item.publicUrl} size="sm" className="min-h-9 px-4" />}
              {item.publicUrl && (
                <Tooltip content="Share">
                  <IconButton aria-label={`Share ${item.name}`} onClick={(e) => p.onShare(e.currentTarget)}>
                    <Share2 aria-hidden="true" />
                  </IconButton>
                </Tooltip>
              )}
              <CardMenu
                item={item}
                busy={p.busy}
                onNote={p.onNote}
                onSecret={p.onSecret}
                onDuplicate={p.onDuplicate}
                onDelete={p.onDelete}
                onActive={p.onActive}
              />
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
