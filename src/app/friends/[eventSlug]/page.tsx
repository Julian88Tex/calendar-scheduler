// /friends/{eventSlug}: the friends link booking page (lib/friends.ts), the same "Select a Date & Time" flow as
// /{handle}/{eventSlug} in the friends voice and theme. ?month, &date, &duration and back=1 restore the state like the
// public page. Unknown slugs are 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bookingMetadata, BookingPageView } from "@/components/booking/booking-page-view";
import { resolveFriendsPage } from "@/components/booking/server/friends";
import { queryOf } from "@/components/booking/server/resolve";

type Props = {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve({ params, searchParams }: Props) {
  const [{ eventSlug }, sp] = await Promise.all([params, searchParams]);
  return resolveFriendsPage(eventSlug, "calendar", null, queryOf(sp));
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return bookingMetadata(await resolve(props));
}

export default async function Page(props: Props) {
  const r = await resolve(props);
  if (!r) notFound();
  return <BookingPageView result={r} />;
}
