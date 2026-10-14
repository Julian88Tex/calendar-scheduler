// OWNER: lifecycle-ui.
//
// /reschedulings/{inviteeId}/{ISO start}: the "Enter Details" step of a reschedule (SPEC CR-03, BK-08, BK-09). The same
// client flow as the calendar page renders the prefilled form with "Reason for change" and "Update Event"; a start
// that is not bookable any more (the moved meeting itself never blocks it, SCH-24) shows the calendar with that date
// preselected and "Sorry, that time is no longer available." Invalid starts and unknown invitees are 404; an old
// invitee of a rescheduled booking redirects to the active invitee's page of the same start.
import type { Metadata, Route } from "next";
import { notFound, redirect } from "next/navigation";
import { changePagePath, queryStringOf } from "@/components/lifecycle/lib/state";
import { lt } from "@/components/lifecycle/lib/t";
import { ReschedulePageView } from "@/components/lifecycle/reschedule-page-view";
import { loadReschedulePage } from "@/components/lifecycle/server/reschedule-page";
import { parseStartParam, startParam } from "@/lib/url";
import { rescheduleInviteeAction } from "../actions";

export const metadata: Metadata = { title: lt("reschedule.title"), robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ inviteeId: string; start: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ inviteeId, start }, sp] = await Promise.all([params, searchParams]);
  const at = parseStartParam(start);
  if (!at) notFound();
  const r = await loadReschedulePage({ inviteeId, mode: "details", start: at, searchParams: sp });
  if (r.state === "not_found") notFound();
  if (r.state === "redirect") {
    const path = changePagePath("reschedule", r.inviteeId).concat(`/${startParam(at)}`);
    const q = queryStringOf(sp);
    redirect((q ? `${path}?${q}` : path) as Route);
  }
  return <ReschedulePageView result={r} rescheduleAction={rescheduleInviteeAction} />;
}
