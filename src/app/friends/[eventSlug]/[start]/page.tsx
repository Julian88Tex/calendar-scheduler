// /friends/{eventSlug}/{ISO start}: the "Enter Details" step of the friends link (lib/friends.ts), like
// /{handle}/{eventSlug}/{start}. A start that is not bookable any more shows the calendar with that date preselected.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bookingMetadata, BookingPageView } from "@/components/booking/booking-page-view";
import { resolveFriendsPage } from "@/components/booking/server/friends";
import { queryOf } from "@/components/booking/server/resolve";

type Props = {
  params: Promise<{ eventSlug: string; start: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve({ params, searchParams }: Props) {
  const [{ eventSlug, start }, sp] = await Promise.all([params, searchParams]);
  return resolveFriendsPage(eventSlug, "details", start, queryOf(sp));
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return bookingMetadata(await resolve(props));
}

export default async function Page(props: Props) {
  const r = await resolve(props);
  if (!r) notFound();
  return <BookingPageView result={r} />;
}
