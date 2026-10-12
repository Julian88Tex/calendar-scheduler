// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// AppHeader (SPEC GEN-20): "Invite user" pill for owners and admins (TM-02, /app/admin/people?invite=1), the account
// menu, and the dismissible banners stacked above the page content.
import type * as React from "react";
import Link from "next/link";
import { buttonClassName } from "../ui/button";
import { AccountMenu } from "./account-menu";
import type { ShellUser } from "./types";

export type AppHeaderProps = {
  user: ShellUser;
  /** Owners and admins see "Invite user". */
  canInvite: boolean;
  canSeeAdminCenter?: boolean;
  /** Banner elements (CalendarProblemBanner, VerifyEmailBanner, ...) rendered under the header row. */
  banners?: React.ReactNode;
};

export function AppHeader({ user, canInvite, canSeeAdminCenter, banners }: AppHeaderProps) {
  return (
    <header className="flex flex-col gap-2 px-6 pt-4">
      <div className="flex items-center justify-end gap-3">
        {canInvite && (
          <Link href="/app/admin/people?invite=1" className={buttonClassName({ variant: "secondary", size: "sm" })}>
            Invite user
          </Link>
        )}
        <AccountMenu user={user} canSeeAdminCenter={canSeeAdminCenter} />
      </div>
      {banners && <div className="flex flex-col gap-2">{banners}</div>}
    </header>
  );
}
