// OWNER: booking-pages.
//
// /{handle}/{eventSlug}/{ISO start}: the "Enter Details" step for one slot (SPEC BK-08, BK-09 to BK-14, BK-17, BK-19;
// observed URL shape /julianjoseph/30min/2026-10-13T18:00:00Z, `Z` or offset forms accepted). The same client flow as
// the calendar page renders the details form; a start that is not bookable any more shows the calendar with that date
// preselected and "Sorry, that time is no longer available." Invalid starts, handles and slugs are 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bookingMetadata, BookingPageView } from "@/components/booking/booking-page-view";
import { queryOf, resolveEventPage } from "@/components/booking/server/resolve";

type Props = {
  params: Promise<{ handle: string; eventSlug: string; start: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve({ params, searchParams }: Props) {
  const [{ handle, eventSlug, start }, sp] = await Promise.all([params, searchParams]);
  return resolveEventPage(handle, eventSlug, "details", start, queryOf(sp));
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
