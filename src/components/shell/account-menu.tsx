// OWNER: foundation-ui.
//
// AccountMenu (SPEC BR-15, walkthrough 4.2): the header avatar (32px, initials fallback) with a chevron opening a 280px
// menu: name and email; "Account settings" (Profile, Branding, My Link, Notifications, Login and security, Cookie
// settings); "Calendar sync" (Calendar settings); "Share your link" (copies the public URL); "Help"; admins also get
// "Admin center" and "Invite users"; then "Log out" (POST /api/auth/logout, AU-05). Keyboard navigable, Escape closes.
"use client";

import {
  CalendarSync,
  ChevronDown,
  Cookie,
  HelpCircle,
  Link as LinkIcon,
  LogOut,
  Palette,
  Share2,
  ShieldCheck,
  User,
  UserPlus,
  Bell,
  KeyRound,
} from "lucide-react";
import { useRef } from "react";
import { copyText } from "@/lib/client/use-copy";
import { Avatar } from "../ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { toast } from "../ui/toast";
import type { ShellUser } from "./types";

export type AccountMenuProps = {
  user: ShellUser;
  canSeeAdminCenter?: boolean;
  /** Owners and admins see "Invite users". */
  canInvite?: boolean;
  /** The user's public landing page URL ("Share your link"); hidden while the user has no handle. */
  publicUrl?: string | null;
  /** Hide the name next to the avatar (mobile top bar). */
  compact?: boolean;
};

export function AccountMenu({ user, canSeeAdminCenter, canInvite, publicUrl, compact }: AccountMenuProps) {
  const logoutForm = useRef<HTMLFormElement>(null);
  return (
    <>
      <form ref={logoutForm} action="/api/auth/logout" method="post" hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
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
            <DropdownMenuItem href="/app/settings/notifications" icon={<Bell aria-hidden="true" />}>
              Notifications
            </DropdownMenuItem>
            <DropdownMenuItem href="/app/settings/login" icon={<KeyRound aria-hidden="true" />}>
              Login and security
            </DropdownMenuItem>
            <DropdownMenuItem href="/app/settings/cookies" icon={<Cookie aria-hidden="true" />}>
              Cookie settings
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
          <DropdownMenuItem href="/help" icon={<HelpCircle aria-hidden="true" />}>
            Help
          </DropdownMenuItem>
          {(canSeeAdminCenter || canInvite) && <DropdownMenuSeparator />}
          {canSeeAdminCenter && (
            <DropdownMenuItem href="/app/admin" icon={<ShieldCheck aria-hidden="true" />}>
              Admin center
            </DropdownMenuItem>
          )}
          {canInvite && (
            <DropdownMenuItem href="/app/admin/people?invite=1" icon={<UserPlus aria-hidden="true" />}>
              Invite users
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<LogOut aria-hidden="true" />} onSelect={() => logoutForm.current?.requestSubmit()}>
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
