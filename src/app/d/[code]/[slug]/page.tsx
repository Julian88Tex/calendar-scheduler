// OWNER: booking-pages.
//
// /d/{code}/{slug} (SPEC BK-27, OO-02, OO-09, ET-34): the booking flow of a single-use link (with its overrides), a
// one-off meeting (its offered times) or a shared event type. Any other slug (an old link ending) answers a permanent
// redirect to the current slug keeping the query; used and expired links show the BK-23 states. Always noindex.
import type { Metadata } from "next";
import type { Route } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { bookingMetadata, BookingPageView } from "@/components/booking/booking-page-view";
import { queryOf, resolveCodePage } from "@/components/booking/server/resolve";

type Props = {
  params: Promise<{ code: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve({ params, searchParams }: Props) {
  const [{ code, slug }, sp] = await Promise.all([params, searchParams]);
  return resolveCodePage(code, slug, "calendar", null, queryOf(sp));
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const r = await resolve(props);
  const m = bookingMetadata(r && r.state !== "redirect" ? r : null);
  return { ...m, robots: { index: false, follow: false } };
}

export default async function Page(props: Props) {
  const r = await resolve(props);
  if (!r) notFound();
  if (r.state === "redirect") permanentRedirect(r.location as Route);
  return <BookingPageView result={r} />;
}
