// OWNER: booking-pages.
//
// /d/{code} (SPEC BK-27): a single-use link, one-off meeting or shared event type code redirects to its canonical
// booking path /d/{code}/{slug} (query kept). Unknown and deleted codes are 404; every /d page is noindex (GEN-13).
import type { Metadata } from "next";
import type { Route } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { queryOf, resolveCodePage } from "@/components/booking/server/resolve";

export const metadata: Metadata = { title: "Book a meeting", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const r = await resolveCodePage(code, null, "calendar", null, queryOf(sp));
  if (!r) notFound();
  if (r.state === "redirect") permanentRedirect(r.location as Route);
  notFound();
}
