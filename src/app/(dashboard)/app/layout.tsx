// OWNER: foundation-ui.
//
// Dashboard shell (ARCHITECTURE section 4 step 3, SPEC GEN-20, GEN-04, GEN-16, GEN-22, GEN-23): requireUser through
// getActorCtx() (redirects to /login?next=...), the sidebar with every nav item (Admin center for owners, admins and
// instance admins), the header (Invite user, account menu, 56px mobile top bar) with the stacked banners (calendar
// problem CAL-15, verify email AU-08, time zone mismatch GEN-23, cron warning for instance admins GEN-16), the user's
// theme (GEN-22) and an opportunistic job run after the response (maybeRunDueJobs, throttled).
import { after } from "next/server";
import type * as React from "react";
import { getOperatorContact } from "@/components/public/operator";
import { AppHeader } from "@/components/shell/app-header";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CalendarProblemBanner } from "@/components/shell/calendar-problem-banner";
import { CronWarningBanner } from "@/components/shell/cron-warning-banner";
import { parseTheme } from "@/components/shell/theme";
import { ThemeController } from "@/components/shell/theme-controller";
import { TimeZoneMismatchBanner } from "@/components/shell/time-zone-mismatch-banner";
import type { ShellUser } from "@/components/shell/types";
import { VerifyEmailBanner } from "@/components/shell/verify-email-banner";
import { canSeeAdminCenter, getActorCtx, isOrgAdmin } from "@/lib/authz";
import { getCalendarHealth } from "@/lib/calendars";
import { fileUrl } from "@/lib/files";
import { maybeRunDueJobs } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { resendVerificationEmail, setSidebarCollapsed, updateProfileTimeZone } from "./_shell/actions";
import { cronWarningApplies, getCreateMenuData, getLastCronAt, publicLinkFor } from "./_shell/data";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActorCtx();
  const { user } = actor;
  const adminCenter = canSeeAdminCenter(actor);
  const orgAdmin = isOrgAdmin(actor);

  const [health, operator, lastCronAt, createMenu] = await Promise.all([
    getCalendarHealth(user.id).catch((e: unknown) => {
      log.warn("shell.calendar_health_failed", { error: e });
      return { ok: true, brokenConnections: [] as { id: string; email: string | null; status: string }[] };
    }),
    getOperatorContact(),
    actor.isInstanceAdmin ? getLastCronAt() : Promise.resolve(null),
    getCreateMenuData(actor),
  ]);
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
  const showCron = actor.isInstanceAdmin && cronWarningApplies(lastCronAt);

  const banners = (
    <>
      <CalendarProblemBanner brokenConnections={health.brokenConnections} />
      {!shellUser.emailVerified && <VerifyEmailBanner email={shellUser.email} resendAction={resendVerificationEmail} />}
      <TimeZoneMismatchBanner profileZone={shellUser.timezone} updateAction={updateProfileTimeZone} />
      {showCron && <CronWarningBanner lastCronAt={lastCronAt} nowMs={now().getTime()} />}
    </>
  );

  return (
    <div className="flex min-h-dvh bg-canvas text-ink">
      <ThemeController theme={parseTheme(user.preferences?.theme)} />
      <AppSidebar
        canSeeAdminCenter={adminCenter}
        initialCollapsed={user.preferences?.sidebarCollapsed === true}
        onCollapsedChange={setSidebarCollapsed}
        operatorEmail={operator?.email ?? null}
        createMenu={createMenu}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader user={shellUser} canInvite={orgAdmin} canSeeAdminCenter={adminCenter} banners={banners} publicUrl={publicLinkFor(user.slug)} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1280px] min-w-0 flex-1 px-4 pt-5 pb-16 outline-none md:px-8 md:pt-3">
          {children}
        </main>
      </div>
    </div>
  );
}
