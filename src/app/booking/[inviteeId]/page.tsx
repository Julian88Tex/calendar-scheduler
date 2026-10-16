// OWNER: booking-pages.
//
// /booking/{inviteeId}: the booking confirmation (SPEC BK-20 to BK-22, CR-01, GEN-13): a capability URL (the invitee id
// alone opens it), noindex. Old invitee ids of a rescheduled booking open the current one; times use the invitee's
// stored zone and time format; the ICS download is /booking/{inviteeId}/event.ics. ?for={persona} (carried from a
// booking made as a persona, lib/personas.ts) shows the event under the persona's name for it and the persona's
// thank-you note; a warm persona also gets the warm voice and theme, the host by first name and "Book another time"
// back to its landing page. Without the parameter the page is the plain one.
import type { Metadata } from "next";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { ConfirmationCard } from "@/components/booking/confirmation-card";
import { EmbedBeacon } from "@/components/booking/embed-beacon";
import { PERSONA_PARAM, toneText } from "@/components/booking/lib/friends";
import { firstNameOf, personaFor, type Persona } from "@/components/booking/lib/personas";
import { bt } from "@/components/booking/lib/t";
import { loadConfirmation, type ConfirmationView } from "@/components/booking/server/confirmation";
import { loadEventPersonas, loadPersonas } from "@/components/booking/server/personas";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { embedDisplayParams } from "@/lib/embed-events";

type Props = {
  params: Promise<{ inviteeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function personaParam(sp: Record<string, string | string[] | undefined>): string | null {
  const v = sp[PERSONA_PARAM];
  return (Array.isArray(v) ? v[0] : v)?.trim() || null;
}

/** The persona a confirmation is shown as: only when the link names one the host has. */
async function personaOf(view: ConfirmationView | null, sp: Record<string, string | string[] | undefined>): Promise<Persona | null> {
  const id = personaParam(sp);
  if (!id || !view?.eventTypeOwnerUserId) return null;
  const persona = personaFor(await loadPersonas(view.eventTypeOwnerUserId), id);
  return persona?.id === id.toLowerCase() ? persona : null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ inviteeId }, sp] = await Promise.all([params, searchParams]);
  const r = await loadConfirmation(inviteeId);
  const persona = await personaOf(r?.state === "ok" ? r.view : null, sp);
  const t = (key: string) => (persona?.style === "warm" ? toneText("friends", key) : bt(key));
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
  const persona = await personaOf(r.view, sp);
  if (persona) {
    const copy = r.view.eventTypeId ? (await loadEventPersonas(r.view.eventTypeId))[persona.id] : undefined;
    const warm = persona.style === "warm" && !embed.embed;
    const pv: ConfirmationView = {
      ...r.view,
      eventName: copy?.name || r.view.eventName,
      ...(warm
        ? {
            scheduledWith: r.view.scheduledWith ? firstNameOf(r.view.scheduledWith) : null,
            ribbon: false,
            scheduleAnother:
              r.view.status === "active" && r.view.ownerLandingPath
                ? { label: toneText("friends", "confirmation.scheduleAnother"), href: `${r.view.ownerLandingPath}?${PERSONA_PARAM}=${encodeURIComponent(persona.id)}` }
                : null,
          }
        : {}),
    };
    if (warm) {
      return (
        <PublicPageShell tone="friends" showFooterLinks={false} operatorEmail={pv.operatorEmail} privacyUrl={pv.privacyUrl}>
          <ConfirmationCard v={pv} tone="friends" note={persona.confirmationNote} />
        </PublicPageShell>
      );
    }
    r.view = pv;
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
      <ConfirmationCard v={v} embed={embed.embed} note={persona?.confirmationNote} />
      {embed.embed && <EmbedBeacon />}
    </PublicPageShell>
  );
}
