// OWNER: booking-pages.
//
// /booking/{inviteeId}: the booking confirmation (SPEC BK-20 to BK-22, CR-01, GEN-13): a capability URL (the invitee id
// alone opens it), noindex. Old invitee ids of a rescheduled booking open the current one; times use the invitee's
// stored zone and time format; the ICS download is /booking/{inviteeId}/event.ics. ?friends=1 (carried from a friends
// mode booking, lib/friends.ts) shows it in the friends voice and theme: friendly event name, the host by first name, the
// host's thank-you note and "Plan another hang" back to /{handle}?friends=1.
import type { Metadata } from "next";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { ConfirmationCard } from "@/components/booking/confirmation-card";
import { EmbedBeacon } from "@/components/booking/embed-beacon";
import { FRIENDS_PARAM, firstNameOf, friendlyEventOf, toneOfParam, toneText } from "@/components/booking/lib/friends";
import { bt } from "@/components/booking/lib/t";
import { loadConfirmation, type ConfirmationView } from "@/components/booking/server/confirmation";
import { loadFriendsContent } from "@/components/booking/server/friends";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { embedDisplayParams } from "@/lib/embed-events";

type Props = {
  params: Promise<{ inviteeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function isFriends(sp: Record<string, string | string[] | undefined>): boolean {
  const v = sp[FRIENDS_PARAM];
  return toneOfParam(Array.isArray(v) ? v[0] : v) === "friends";
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ inviteeId }, sp] = await Promise.all([params, searchParams]);
  const r = await loadConfirmation(inviteeId);
  const t = (key: string) => (isFriends(sp) ? toneText("friends", key) : bt(key));
  const title =
    r?.state === "ok"
      ? r.view.status === "canceled"
        ? t("confirmation.canceledTitle")
        : r.view.rescheduled
          ? t("confirmation.titleRescheduled")
          : t("confirmation.title")
      : t("states.notFoundTitle");
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
  if (isFriends(sp) && !embed.embed) {
    const content = await loadFriendsContent(r.view.eventTypeOwnerUserId);
    const friendly = friendlyEventOf(content, r.view.eventTypeSlug);
    const fv: ConfirmationView = {
      ...r.view,
      eventName: friendly?.name || r.view.eventName,
      scheduledWith: r.view.scheduledWith ? firstNameOf(r.view.scheduledWith) : null,
      ribbon: false,
      scheduleAnother:
        r.view.status === "active" && r.view.ownerLandingPath
          ? { label: toneText("friends", "confirmation.scheduleAnother"), href: `${r.view.ownerLandingPath}?${FRIENDS_PARAM}=1` }
          : null,
    };
    return (
      <PublicPageShell tone="friends" showFooterLinks={false} operatorEmail={fv.operatorEmail} privacyUrl={fv.privacyUrl}>
        <ConfirmationCard v={fv} tone="friends" friendsNote={content.confirmationNote} />
      </PublicPageShell>
    );
  }
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
