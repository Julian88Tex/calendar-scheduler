// OWNER: booking-pages. 404 of confirmation pages (SPEC BK-23).
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
