// OWNER: foundation-ui.
//
// AccountMenu (SPEC BR-15 narrowed by docs/SCOPE.md, walkthrough 4.2): the header avatar (32px, initials fallback) with
// a chevron opening a 280px menu: name and email; "Account settings" (Profile, Branding, My Link, Login and security:
// the settings pages docs/SCOPE.md keeps); "Calendar sync" (Calendar settings); "Share your link" (copies the public
// URL); "Help" (the in-app Help center); then "Log out" (POST /api/auth/logout, AU-05). Notifications, Cookie settings,
// Admin center and Invite users lead to areas docs/SCOPE.md does not build, so they are not offered. Keyboard
// navigable, Escape closes.
"use client";

import { CalendarSync, ChevronDown, HelpCircle, KeyRound, Link as LinkIcon, LogOut, Palette, Share2, User } from "lucide-react";
import { useRef, useState } from "react";
import { copyText } from "@/lib/client/use-copy";
import { Avatar } from "../ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { toast } from "../ui/toast";
import { HelpCenterDialog } from "./help-center";
import type { ShellUser } from "./types";

export type AccountMenuProps = {
  user: ShellUser;
  /** Kept for compatibility: the Admin center is out of scope (docs/SCOPE.md), so the menu has no entry for it. */
  canSeeAdminCenter?: boolean;
  /** Kept for compatibility: inviting users is out of scope (docs/SCOPE.md), so the menu has no "Invite users". */
  canInvite?: boolean;
  /** The user's public landing page URL ("Share your link"); hidden while the user has no handle. */
  publicUrl?: string | null;
  /** Hide the name next to the avatar (mobile top bar). */
  compact?: boolean;
  /** Instance operator email for the Help center's "Report a problem" link (MK-02). */
  operatorEmail?: string | null;
};

export function AccountMenu({ user, publicUrl, compact, operatorEmail }: AccountMenuProps) {
  const logoutForm = useRef<HTMLFormElement>(null);
  const [helpCenter, setHelpCenter] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <form ref={logoutForm} action="/api/auth/logout" method="post" hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          aria-label="Account menu"
          className="inline-flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 text-ink-2 transition-colors hover:bg-pebble data-[state=open]:bg-pebble"
        >
          <Avatar src={user.avatarUrl} name={user.name} alt="" size="md" />
          {!compact && <ChevronDown aria-hidden="true" className="size-4" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[280px]">
          <div className="flex items-center gap-3 px-3 pt-2.5 pb-3">
            <Avatar src={user.avatarUrl} name={user.name} alt="" size={40} />
            <div className="min-w-0">
              <p className="truncate text-[14px] leading-5 font-bold text-ink">{user.name}</p>
              <p className="truncate text-[12px] leading-4 text-ink-2">{user.email}</p>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Account settings</DropdownMenuLabel>
            <DropdownMenuItem href="/app/settings/profile" icon={<User aria-hidden="true" />}>
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem href="/app/settings/branding" icon={<Palette aria-hidden="true" />}>
              Branding
            </DropdownMenuItem>
            <DropdownMenuItem href="/app/settings/link" icon={<LinkIcon aria-hidden="true" />}>
              My Link
            </DropdownMenuItem>
            <DropdownMenuItem href="/app/settings/login" icon={<KeyRound aria-hidden="true" />}>
              Login and security
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem href="/app/availability/calendar-settings" icon={<CalendarSync aria-hidden="true" />}>
            Calendar sync
          </DropdownMenuItem>
          {publicUrl && (
            <DropdownMenuItem
              icon={<Share2 aria-hidden="true" />}
              onSelect={async () => {
                if (await copyText(publicUrl)) toast.success("Link copied", { description: publicUrl });
                else toast.error("Couldn't copy the link.", { description: publicUrl });
              }}
            >
              Share your link
            </DropdownMenuItem>
          )}
          <DropdownMenuItem icon={<HelpCircle aria-hidden="true" />} onSelect={() => setHelpCenter(true)}>
            Help
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<LogOut aria-hidden="true" />} onSelect={() => logoutForm.current?.requestSubmit()}>
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <HelpCenterDialog open={helpCenter} onOpenChange={setHelpCenter} operatorEmail={operatorEmail} returnFocusRef={triggerRef} />
    </>
  );
}
