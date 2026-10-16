// Event type editor panel header (SPEC ET-14, walkthrough 7.1): back arrow + "Event types", the kind eyebrow, the event
// name with its color, "Secret" and "Off" badges, the internal note, and the kebab with event-level actions (ET-05
// order, minus the features docs/SCOPE.md skips): View booking page, Copy link, Add or Edit internal note, Make secret
// or Make public, Duplicate, Delete, and the On/Off switch row. Client component.
"use client";

import { ChevronLeft, Copy, CopyPlus, ExternalLink, EyeOff, MoreVertical, NotebookPen, Eye, StickyNote, Trash2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";

export type EditorHeaderProps = {
  kindLabel: string;
  name: string;
  color: string;
  secret: boolean;
  active: boolean;
  internalNote: string;
  saved: boolean;
  canEdit: boolean;
  canDelete: boolean;
  publicUrl: string | null;
  busy: boolean;
  onBack: () => void;
  onCopyLink: () => void;
  onNote: () => void;
  onSecret: (secret: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onActive: (active: boolean) => void;
};

export function EditorHeader(p: EditorHeaderProps) {
  const name = p.name.trim() || "Untitled event type";
  const showMenu = p.saved || p.canEdit;
  return (
    <header className="flex shrink-0 flex-col gap-3 border-b border-line px-4 pt-3 pb-4 sm:px-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/app/scheduling"
          onClick={(e) => {
            e.preventDefault();
            p.onBack();
          }}
          className="-ml-2 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-body-md font-semibold text-primary-text hover:bg-primary-soft"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Event types
        </Link>
        {showMenu && (
          <DropdownMenu>
            <Tooltip content="Event type actions">
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="Event type actions" disabled={p.busy}>
                  <MoreVertical aria-hidden="true" className="size-5" />
                </IconButton>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-64">
              {p.saved && p.publicUrl && (
                <DropdownMenuItem asChild>
                  <a href={p.publicUrl} target="_blank" rel="noopener noreferrer">
                    <span className="inline-flex text-ink-2">
                      <ExternalLink aria-hidden="true" className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">View booking page</span>
                  </a>
                </DropdownMenuItem>
              )}
              {p.saved && p.publicUrl && (
                <DropdownMenuItem icon={<Copy aria-hidden="true" className="size-4" />} onSelect={p.onCopyLink}>
                  Copy link
                </DropdownMenuItem>
              )}
              {p.canEdit && (
                <DropdownMenuItem icon={<NotebookPen aria-hidden="true" className="size-4" />} onSelect={p.onNote}>
                  {p.internalNote ? "Edit internal note" : "Add internal note"}
                </DropdownMenuItem>
              )}
              {p.canEdit && (
                <DropdownMenuItem
                  icon={p.secret ? <Eye aria-hidden="true" className="size-4" /> : <EyeOff aria-hidden="true" className="size-4" />}
                  onSelect={() => p.onSecret(!p.secret)}
                >
                  {p.secret ? "Make public" : "Make secret"}
                </DropdownMenuItem>
              )}
              {p.saved && p.canEdit && (
                <DropdownMenuItem icon={<CopyPlus aria-hidden="true" className="size-4" />} onSelect={p.onDuplicate}>
                  Duplicate
                </DropdownMenuItem>
              )}
              {p.saved && p.canDelete && (
                <DropdownMenuItem destructive icon={<Trash2 aria-hidden="true" className="size-4" />} onSelect={p.onDelete}>
                  Delete
                </DropdownMenuItem>
              )}
              {p.saved && p.canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSwitchItem checked={p.active} onCheckedChange={p.onActive}>
                    On/Off
                  </DropdownMenuSwitchItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-eyebrow text-ink-2">{p.kindLabel}</p>
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="size-4 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
          <h1 className="min-w-0 truncate text-title-md text-ink">{name}</h1>
          {p.secret && (
            <Badge variant="neutral" size="sm" icon={<EyeOff aria-hidden="true" className="size-3" />}>
              Secret
            </Badge>
          )}
          {p.saved && !p.active && (
            <Badge variant="outline" size="sm">
              Off
            </Badge>
          )}
        </div>
        {p.internalNote && (
          <p className="mt-1 flex min-w-0 items-start gap-1.5 text-body-sm text-ink-2">
            <StickyNote aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span className="line-clamp-2 break-words">
              <span className="sr-only">Internal note: </span>
              {p.internalNote}
            </span>
          </p>
        )}
      </div>
    </header>
  );
}
