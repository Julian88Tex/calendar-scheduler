// OWNER: booking-pages.
//
// /booking/{inviteeId}: the booking confirmation (SPEC BK-20 to BK-22, CR-01, GEN-13): a capability URL (the invitee id
// alone opens it), noindex. Old invitee ids of a rescheduled booking open the current one; times use the invitee's
// stored zone and time format; the ICS download is /booking/{inviteeId}/event.ics.
import type { Metadata } from "next";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { ConfirmationCard } from "@/components/booking/confirmation-card";
import { EmbedBeacon } from "@/components/booking/embed-beacon";
import { bt } from "@/components/booking/lib/t";
import { loadConfirmation } from "@/components/booking/server/confirmation";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { embedDisplayParams } from "@/lib/embed-events";

type Props = {
  params: Promise<{ inviteeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { inviteeId } = await params;
  const r = await loadConfirmation(inviteeId);
  const title =
    r?.state === "ok"
      ? r.view.status === "canceled"
        ? bt("confirmation.canceledTitle")
        : r.view.rescheduled
          ? bt("confirmation.titleRescheduled")
          : bt("confirmation.title")
      : bt("states.notFoundTitle");
  return { title, robots: { index: false, follow: false } };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ inviteeId }, sp] = await Promise.all([params, searchParams]);
  const r = await loadConfirmation(inviteeId);
  if (!r) notFound();
  if (r.state === "redirect") {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
    const qs = q.toString();
    redirect(`/booking/${encodeURIComponent(r.inviteeId)}${qs ? `?${qs}` : ""}` as Route);
  }
  const embed = embedDisplayParams(sp);
  const v = r.view;
  return (
    <PublicPageShell
      branding={{ primaryColor: embed.primaryColor ?? v.branding.primaryColor, backgroundColor: embed.backgroundColor ?? v.branding.backgroundColor, textColor: embed.textColor ?? v.branding.textColor }}
      embed={embed.embed}
      showFooterLinks={false}
      hideGdprBanner={embed.hideGdprBanner}
      operatorEmail={v.operatorEmail}
      privacyUrl={v.privacyUrl}
    >
      <ConfirmationCard v={v} embed={embed.embed} />
      {embed.embed && <EmbedBeacon />}
    </PublicPageShell>
  );
}
