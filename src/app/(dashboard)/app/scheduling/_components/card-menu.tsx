// The kebab menu of an event type card (SPEC ET-05, walkthrough 5.1): Calendly's items in their exact order minus the
// features docs/SCOPE.md does not build (Edit permissions, Add to website, Change invitee language and Event
// statistics belong to teams, embeds and translations): View booking page, Edit, Add or Edit internal note, Make
// secret or Make public, Duplicate, Delete, and the On/Off switch row at the bottom. Items the user lacks permission
// for are hidden. Radix menu keyboard support: arrows, Home/End, typeahead, Enter/Space, Escape. Client component.
"use client";

import { CopyPlus, ExternalLink, Eye, EyeOff, MoreVertical, NotebookPen, Pencil, Trash2 } from "lucide-react";
import type { Route } from "next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import type { EventTypeListItem } from "@/lib/event-types/types";

export type CardMenuProps = {
  item: Pick<EventTypeListItem, "id" | "name" | "publicUrl" | "internalNote" | "secret" | "active" | "access">;
  busy: boolean;
  onNote: () => void;
  onSecret: (secret: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onActive: (active: boolean) => void;
};

export function CardMenu({ item, busy, onNote, onSecret, onDuplicate, onDelete, onActive }: CardMenuProps) {
  const canEdit = item.access !== "view";
  const canDelete = item.access === "owner";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={`${item.name} actions`} size="md">
          <MoreVertical aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {item.publicUrl && (
          <DropdownMenuItem asChild>
            <a href={item.publicUrl} target="_blank" rel="noopener noreferrer">
              <span className="inline-flex text-ink-2">
                <ExternalLink aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">View booking page</span>
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem icon={<Pencil aria-hidden="true" />} href={`/app/event-types/${item.id}` as Route}>
          Edit
        </DropdownMenuItem>
        {canEdit && (
          <DropdownMenuItem icon={<NotebookPen aria-hidden="true" />} disabled={busy} onSelect={onNote}>
            {item.internalNote ? "Edit internal note" : "Add internal note"}
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuItem
            icon={item.secret ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            disabled={busy}
            onSelect={() => onSecret(!item.secret)}
          >
            {item.secret ? "Make public" : "Make secret"}
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuItem icon={<CopyPlus aria-hidden="true" />} disabled={busy} onSelect={onDuplicate}>
            Duplicate
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem destructive icon={<Trash2 aria-hidden="true" />} disabled={busy} onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        )}
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSwitchItem checked={item.active} disabled={busy} onCheckedChange={onActive}>
              On/Off
            </DropdownMenuSwitchItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
