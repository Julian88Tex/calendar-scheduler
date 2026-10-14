// OWNER: lifecycle-ui.
//
// /cancellations/{inviteeId}: the invitee cancel page (SPEC CR-02, CR-05, SCH-23, GEN-08; walkthrough 11.6). The
// invitee id is a capability URL from the confirmation emails, reminders and the confirmation page: noindex, never
// framed (frame-ancestors 'none' from src/lib/net/frame-policy.ts), 404 for unknown ids. An old invitee of a
// rescheduled booking redirects to the active invitee of its chain, so links in older emails keep working. Canceling
// works even when the event type is now off or deleted; the page shows "This event has already been canceled.",
// "This event has already occurred." or the cutoff message when canceling online is no longer possible. The form posts
// through a Server Action (no state change on GET).
import type { Metadata, Route } from "next";
import { notFound, redirect } from "next/navigation";
import { CancelPage } from "@/components/lifecycle/cancel-page";
import { changePagePath, queryStringOf } from "@/components/lifecycle/lib/state";
import { lt } from "@/components/lifecycle/lib/t";
import { loadChangePage } from "@/components/lifecycle/server/change-page";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { cancelInviteeAction } from "./actions";

export const metadata: Metadata = { title: lt("cancel.title"), robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ inviteeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ inviteeId }, sp] = await Promise.all([params, searchParams]);
  const r = await loadChangePage(inviteeId, "cancel");
  if (r.state === "not_found") notFound();
  if (r.state === "redirect") redirect(changePagePath("cancel", r.inviteeId, queryStringOf(sp)) as Route);
  const v = r.view;
  return (
    <PublicPageShell branding={v.shell.branding} showFooterLinks={false} operatorEmail={v.shell.operatorEmail} privacyUrl={v.shell.privacyUrl}>
      <CancelPage view={v} cancelAction={cancelInviteeAction} />
    </PublicPageShell>
  );
}
