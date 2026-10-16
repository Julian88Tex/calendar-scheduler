// OWNER: booking-pages.
//
// /{handle}/{eventSlug}: the booking page, "Select a Date & Time" (SPEC BK-03 to BK-08, BK-24 to BK-26, BK-30, BK-33,
// ET-10, ET-29). ?month=YYYY-MM, &date=YYYY-MM-DD, &duration and back=1 restore the state; secret types are bookable
// by link and noindex; off types show the BK-23 state (the host still sees the page); /{handle}/__preview__?preview=1
// is the editor preview of an unsaved event type (owners only). Unknown handles and slugs are 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bookingMetadata, BookingPageView } from "@/components/booking/booking-page-view";
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
  return bookingMetadata(r && r.state !== "redirect" ? r : null);
}

export default async function Page(props: Props) {
  const r = await resolve(props);
  if (!r || r.state === "redirect") notFound();
  return <BookingPageView result={r} />;
}
