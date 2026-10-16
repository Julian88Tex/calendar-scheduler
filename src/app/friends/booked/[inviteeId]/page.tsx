// /friends/booked/{inviteeId}: the confirmation of a booking made through the friends link (lib/friends.ts): the same
// capability URL and data as /booking/{inviteeId}, in the friends voice and theme, with "Plan another hang" back to
// /friends, the host by first name and no "Powered by" line. Never indexed. Old invitee ids of a rescheduled booking
// open the current one.
import type { Metadata, Route } from "next";
import { notFound, redirect } from "next/navigation";
import { ConfirmationCard } from "@/components/booking/confirmation-card";
import { FRIENDS_BOOKED_PATH, FRIENDS_PATH, firstNameOf, friendlyEventOf, toneText } from "@/components/booking/lib/friends";
import { loadConfirmation } from "@/components/booking/server/confirmation";
import { PublicPageShell } from "@/components/public/public-page-shell";

type Props = { params: Promise<{ inviteeId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { inviteeId } = await params;
  const r = await loadConfirmation(inviteeId);
  const title =
    r?.state === "ok"
      ? r.view.status === "canceled"
        ? toneText("friends", "confirmation.canceledTitle")
        : toneText("friends", r.view.rescheduled ? "confirmation.titleRescheduled" : "confirmation.title")
      : toneText("friends", "states.notFoundTitle");
  return { title, robots: { index: false, follow: false } };
}

export default async function Page({ params }: Props) {
  const { inviteeId } = await params;
  const r = await loadConfirmation(inviteeId);
  if (!r) notFound();
  if (r.state === "redirect") redirect(`${FRIENDS_BOOKED_PATH}/${encodeURIComponent(r.inviteeId)}` as Route);
  const friendly = friendlyEventOf(r.view.eventTypeSlug);
  const v = {
    ...r.view,
    eventName: friendly?.name ?? r.view.eventName,
    scheduledWith: r.view.scheduledWith ? firstNameOf(r.view.scheduledWith) : null,
    ribbon: false,
    scheduleAnother: r.view.status === "active" ? { label: toneText("friends", "confirmation.scheduleAnother"), href: FRIENDS_PATH } : null,
  };
  return (
    <PublicPageShell tone="friends" showFooterLinks={false} operatorEmail={v.operatorEmail} privacyUrl={v.privacyUrl}>
      <ConfirmationCard v={v} tone="friends" />
    </PublicPageShell>
  );
}
