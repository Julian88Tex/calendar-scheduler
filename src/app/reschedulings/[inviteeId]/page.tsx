// OWNER: lifecycle-ui.
//
// /reschedulings/{inviteeId}: the invitee reschedule page (SPEC CR-03, CR-08, SCH-23, SCH-24, BK-07, GEN-08;
// walkthrough 11.7). A capability URL from the confirmation emails, reminders, the confirmation page and the host's
// "Share new times to meet" email: noindex, never framed (frame-ancestors 'none' from src/lib/net/frame-policy.ts), 404
// for unknown ids. An old invitee of a rescheduled booking redirects to the active invitee of its chain. The booking
// calendar of the same event type with the "Former Time" struck through; "This event can no longer be rescheduled."
// for canceled meetings, meetings that started, event types now off or deleted, one-off and poll meetings (the cancel
// page keeps working); the SCH-23 cutoff message inside the cutoff window.
import type { Metadata, Route } from "next";
import { notFound, redirect } from "next/navigation";
import { changePagePath, queryStringOf } from "@/components/lifecycle/lib/state";
import { lt } from "@/components/lifecycle/lib/t";
import { ReschedulePageView } from "@/components/lifecycle/reschedule-page-view";
import { loadReschedulePage } from "@/components/lifecycle/server/reschedule-page";
import { rescheduleInviteeAction } from "./actions";

export const metadata: Metadata = { title: lt("reschedule.title"), robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ inviteeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ inviteeId }, sp] = await Promise.all([params, searchParams]);
  const r = await loadReschedulePage({ inviteeId, mode: "calendar", searchParams: sp });
  if (r.state === "not_found") notFound();
  if (r.state === "redirect") redirect(changePagePath("reschedule", r.inviteeId, queryStringOf(sp)) as Route);
  return <ReschedulePageView result={r} rescheduleAction={rescheduleInviteeAction} />;
}
