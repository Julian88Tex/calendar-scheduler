// OWNER: booking-pages.
//
// 404 of public profile and booking pages (SPEC BK-23): "This page isn't available" with "The link may be broken or the
// page may have been removed." and a link to the homepage.
import type { Metadata } from "next";
import { bt } from "@/components/booking/lib/t";
import { StateCard } from "@/components/booking/state-card";
import { PublicPageShell } from "@/components/public/public-page-shell";

export const metadata: Metadata = { title: bt("states.notFoundTitle"), robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <PublicPageShell showFooterLinks={false}>
      <StateCard kind="not_found" ribbon={false} />
    </PublicPageShell>
  );
}
