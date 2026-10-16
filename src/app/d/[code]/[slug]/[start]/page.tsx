// OWNER: booking-pages.
//
// /d/{code}/{slug}/{ISO start} (SPEC BK-27, BK-09): the details form of a link's slot; an old slug redirects
// permanently to the current one with the same start and query. Always noindex.
import type { Metadata } from "next";
import type { Route } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { bookingMetadata, BookingPageView } from "@/components/booking/booking-page-view";
import { queryOf, resolveCodePage } from "@/components/booking/server/resolve";

type Props = {
  params: Promise<{ code: string; slug: string; start: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve({ params, searchParams }: Props) {
  const [{ code, slug, start }, sp] = await Promise.all([params, searchParams]);
  return resolveCodePage(code, slug, "details", start, queryOf(sp));
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
