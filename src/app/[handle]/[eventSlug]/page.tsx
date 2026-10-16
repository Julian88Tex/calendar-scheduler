// OWNER: booking-pages.
//
// /{handle}/{eventSlug}: the booking page, "Select a Date & Time" (SPEC BK-03 to BK-08, BK-24 to BK-26, BK-30, BK-33,
// ET-10, ET-29). ?month=YYYY-MM, &date=YYYY-MM-DD, &duration and back=1 restore the state; secret types are bookable
// by link and noindex; off types show the BK-23 state (the host still sees the page); /{handle}/__preview__?preview=1
// is the editor preview of an unsaved event type (owners only). Unknown handles and slugs are 404. Shared links preview
// as the event type's card (og-card.ts).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bookingMetadata, BookingPageView } from "@/components/booking/booking-page-view";
import { PERSONA_PARAM } from "@/components/booking/lib/friends";
import { ogImageMeta } from "@/components/booking/server/og-card";
import { queryOf, resolveEventPage } from "@/components/booking/server/resolve";

type Props = {
  params: Promise<{ handle: string; eventSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve({ params, searchParams }: Props) {
  const [{ handle, eventSlug }, sp] = await Promise.all([params, searchParams]);
  return resolveEventPage(handle, eventSlug, "calendar", null, queryOf(sp));
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const r = await resolve(props);
  const meta = bookingMetadata(r && r.state !== "redirect" ? r : null);
  if (!r || r.state !== "ok") return meta;
  // The link preview card of the event type, in the persona the link asks for (og-card.ts).
  const [{ handle, eventSlug }, sp] = await Promise.all([props.params, props.searchParams]);
  const persona = sp[PERSONA_PARAM];
  const og = ogImageMeta({ handle, event: eventSlug, persona: Array.isArray(persona) ? persona[0] : persona }, r.meta.ogTitle);
  return { ...meta, openGraph: { ...meta.openGraph, images: og.images }, twitter: { ...og.twitter, title: r.meta.ogTitle, description: meta.description ?? undefined } };
}

export default async function Page(props: Props) {
  const r = await resolve(props);
  if (!r || r.state === "redirect") notFound();
  return <BookingPageView result={r} />;
}
