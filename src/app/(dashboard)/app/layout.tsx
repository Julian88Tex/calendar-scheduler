// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Dashboard shell (ARCHITECTURE section 4 step 3, SPEC GEN-20): requireUser() (redirects to /login?next=...), the actor
// (org role, team roles), the sidebar with every nav item, the header with banners, and an opportunistic job run after
// the response (maybeRunDueJobs, throttled).
import { after } from "next/server";
import type * as React from "react";
import { AppHeader } from "@/components/shell/app-header";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CalendarProblemBanner } from "@/components/shell/calendar-problem-banner";
import { TimeZoneMismatchBanner } from "@/components/shell/time-zone-mismatch-banner";
import type { ShellUser } from "@/components/shell/types";
import { VerifyEmailBanner } from "@/components/shell/verify-email-banner";
import { canSeeAdminCenter, getActorCtx, isOrgAdmin } from "@/lib/authz";
import { getCalendarHealth } from "@/lib/calendars";
import { fileUrl } from "@/lib/files";
import { maybeRunDueJobs } from "@/lib/jobs";
import { setSidebarCollapsed, updateProfileTimeZone } from "./_shell/actions";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActorCtx();
  const { user } = actor;
  const health = await getCalendarHealth(user.id);
  after(() => maybeRunDueJobs());

  const shellUser: ShellUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarFileId ? fileUrl(user.avatarFileId) : user.avatarUrl,
    slug: user.slug,
    timezone: user.timezone,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
  const adminCenter = canSeeAdminCenter(actor);
  const banners = (
    <>
      <CalendarProblemBanner brokenConnections={health.brokenConnections} />
      {!shellUser.emailVerified && <VerifyEmailBanner email={shellUser.email} />}
      <TimeZoneMismatchBanner profileZone={shellUser.timezone} updateAction={updateProfileTimeZone} />
    </>
  );

  return (
    <div className="flex min-h-screen bg-white">
      <AppSidebar
        canSeeAdminCenter={adminCenter}
        initialCollapsed={user.preferences?.sidebarCollapsed === true}
        onCollapsedChange={setSidebarCollapsed}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader user={shellUser} canInvite={isOrgAdmin(actor)} canSeeAdminCenter={adminCenter} banners={banners} />
        <main id="main" className="flex-1 px-6 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
