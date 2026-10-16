// OWNER: foundation-ui.
//
// Dashboard shell (ARCHITECTURE section 4 step 3, SPEC GEN-20, GEN-04, GEN-16, GEN-22, GEN-23, docs/SCOPE.md):
// requireUser through getActorCtx() (redirects to /login?next=...), the sidebar with the nav items docs/SCOPE.md keeps,
// the header (account menu, 56px mobile top bar) with the stacked banners (calendar problem CAL-15, verify email
// AU-08, time zone mismatch GEN-23, cron warning with its setup steps for instance admins GEN-16, also shown for
// overdue reminders on any deployment), the user's theme
// (GEN-22) and an opportunistic job run after the response (maybeRunDueJobs, throttled).
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
import { canSeeAdminCenter, getActorCtx } from "@/lib/authz";
import { getCalendarHealth } from "@/lib/calendars";
import { getFeatures } from "@/lib/env";
import { fileUrl } from "@/lib/files";
import { maybeRunDueJobs } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { resendVerificationEmail, setSidebarCollapsed, updateProfileTimeZone } from "./_shell/actions";
import { cronEndpointUrl, cronWarningApplies, getLastCronAt, getOverdueReminderCount, publicLinkFor } from "./_shell/data";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActorCtx();
  const { user } = actor;
  const adminCenter = canSeeAdminCenter(actor);

  const [health, operator, lastCronAt, overdueReminders] = await Promise.all([
    getCalendarHealth(user.id).catch((e: unknown) => {
      log.warn("shell.calendar_health_failed", { error: e });
      return { ok: true, brokenConnections: [] as { id: string; email: string | null; status: string }[] };
    }),
    getOperatorContact(),
    actor.isInstanceAdmin ? getLastCronAt() : Promise.resolve(null),
    actor.isInstanceAdmin ? getOverdueReminderCount() : Promise.resolve(0),
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
  const checkCron = cronWarningApplies(lastCronAt);
  const showCron = actor.isInstanceAdmin && (checkCron || overdueReminders > 0);

  const banners = (
    <>
      <CalendarProblemBanner brokenConnections={health.brokenConnections} />
      {!shellUser.emailVerified && <VerifyEmailBanner email={shellUser.email} resendAction={resendVerificationEmail} />}
      <TimeZoneMismatchBanner profileZone={shellUser.timezone} updateAction={updateProfileTimeZone} />
      {showCron && (
        <CronWarningBanner
          lastCronAt={lastCronAt}
          nowMs={now().getTime()}
          cronUrl={cronEndpointUrl()}
          secretConfigured={getFeatures().cronSecret}
          checkCron={checkCron}
          overdueReminders={overdueReminders}
        />
      )}
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
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          user={shellUser}
          canInvite={false}
          canSeeAdminCenter={adminCenter}
          banners={banners}
          publicUrl={publicLinkFor(user.slug)}
          operatorEmail={operator?.email ?? null}
        />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1280px] min-w-0 flex-1 px-4 pt-5 pb-16 outline-none md:px-8 md:pt-3">
          {children}
        </main>
      </div>
    </div>
  );
}
