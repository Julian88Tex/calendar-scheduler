// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// AccountMenu (SPEC BR-15): avatar trigger with the user's name and email, settings links, Admin center for admins and
// "Log out" (POST /api/auth/logout, AU-05).
"use client";

import { useRef } from "react";
import { Avatar } from "../ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import type { ShellUser } from "./types";

export type AccountMenuProps = { user: ShellUser; canSeeAdminCenter?: boolean };

export function AccountMenu({ user, canSeeAdminCenter }: AccountMenuProps) {
  const logoutForm = useRef<HTMLFormElement>(null);
  return (
    <>
    <form ref={logoutForm} action="/api/auth/logout" method="post" hidden />
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Account menu" className="rounded-full">
        <Avatar src={user.avatarUrl} name={user.name} alt="" size="md" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel className="normal-case">
          <span className="block text-body-md font-semibold text-ink">{user.name}</span>
          <span className="block text-body-sm text-ink-2">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem href="/app/settings/profile">Profile</DropdownMenuItem>
        <DropdownMenuItem href="/app/settings/branding">Branding</DropdownMenuItem>
        <DropdownMenuItem href="/app/settings/link">My Link</DropdownMenuItem>
        <DropdownMenuItem href="/app/settings/login">Login preferences</DropdownMenuItem>
        <DropdownMenuItem href="/app/settings/notifications">Notifications</DropdownMenuItem>
        <DropdownMenuItem href="/app/availability/calendar-settings">Calendar sync</DropdownMenuItem>
        {canSeeAdminCenter && <DropdownMenuItem href="/app/admin">Admin center</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logoutForm.current?.requestSubmit()}>Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}
