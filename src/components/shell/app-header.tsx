// OWNER: foundation-ui.
//
// AppHeader (SPEC GEN-20, GEN-04, TM-02, walkthrough 4.2 and 4.3): on desktop, the top-right row with the "Invite user"
// pill for owners and admins (/app/admin/people?invite=1) and the account menu; below 768px, a 56px white top bar with
// the hamburger (opens the sidebar drawer), the logo and the avatar. Dismissible banners stack under it, above the page
// content.
"use client";

import { Menu, UserPlus } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { buttonClassName } from "../ui/button";
import { Logo } from "../ui/logo";
import { AccountMenu } from "./account-menu";
import { setMobileNavOpen, useMobileNavOpen } from "./mobile-nav";
import type { ShellUser } from "./types";

export type AppHeaderProps = {
  user: ShellUser;
  /** Owners and admins see "Invite user". */
  canInvite: boolean;
  canSeeAdminCenter?: boolean;
  /** Banner elements (CalendarProblemBanner, VerifyEmailBanner, ...) rendered under the header row. */
  banners?: React.ReactNode;
  /** The user's public landing page URL for the account menu's "Share your link". */
  publicUrl?: string | null;
};

export function AppHeader({ user, canInvite, canSeeAdminCenter, banners, publicUrl }: AppHeaderProps) {
  const drawerOpen = useMobileNavOpen();
  return (
    <header className="flex min-w-0 flex-col">
      {/* Phone and small tablet: 56px top bar. */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-white px-2 md:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          onClick={() => setMobileNavOpen(true)}
          className="inline-flex size-10 items-center justify-center rounded-full text-ink hover:bg-pebble"
        >
          <Menu aria-hidden="true" className="size-6" />
        </button>
        <Logo variant="full" href="/app/scheduling" size={28} />
        <div className="ml-auto">
          <AccountMenu user={user} canSeeAdminCenter={canSeeAdminCenter} canInvite={canInvite} publicUrl={publicUrl} compact />
        </div>
      </div>
      {/* Desktop: top-right actions. */}
      <div className="hidden items-center justify-end gap-3 px-8 pt-4 pb-1 md:flex">
        {canInvite && (
          <Link href="/app/admin/people?invite=1" className={buttonClassName({ variant: "secondary", size: "sm" })}>
            <UserPlus aria-hidden="true" />
            Invite user
          </Link>
        )}
        <AccountMenu user={user} canSeeAdminCenter={canSeeAdminCenter} canInvite={canInvite} publicUrl={publicUrl} />
      </div>
      {banners && <div className="flex min-w-0 flex-col gap-2 px-4 pt-3 empty:hidden md:px-8">{banners}</div>}
    </header>
  );
}
