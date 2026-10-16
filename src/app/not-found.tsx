// OWNER: foundation-ui.
//
// Root 404 page (SPEC GEN-12): "Page not found", "This link isn't valid. Check the URL or go back to the homepage." and
// a "Go to homepage" button, on the public canvas (it also catches unknown public slugs).
import type { Metadata } from "next";
import Link from "next/link";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Illustration } from "@/components/ui/illustration";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <PublicPageShell showFooterLinks={false}>
      <PublicCard width="narrow" ribbon={false}>
        <EmptyState
          headingLevel={1}
          illustration={<Illustration name="not-found" />}
          heading="Page not found"
          body="This link isn't valid. Check the URL or go back to the homepage."
          action={
            <Link href="/" className={buttonClassName({ variant: "primary", size: "lg" })}>
              Go to homepage
            </Link>
          }
        />
      </PublicCard>
    </PublicPageShell>
  );
}
