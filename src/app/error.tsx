// OWNER: foundation-ui.
//
// Root error boundary (SPEC GEN-12): "Something went wrong" with "Try again"; never shows internals (only the opaque
// digest as a reference for the operator's logs).
"use client";

import Link from "next/link";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { Button, buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Illustration } from "@/components/ui/illustration";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PublicPageShell showFooterLinks={false}>
      <PublicCard width="narrow" ribbon={false}>
        <EmptyState
          headingLevel={1}
          illustration={<Illustration name="error" />}
          heading="Something went wrong"
          body={
            <>
              We couldn&apos;t load this page. Try again in a moment.
              {error.digest && <span className="mt-2 block text-body-sm">Reference: {error.digest}</span>}
            </>
          }
          action={<Button onClick={() => reset()}>Try again</Button>}
          secondaryAction={
            <Link href="/" className={buttonClassName({ variant: "secondary" })}>
              Go to homepage
            </Link>
          }
        />
      </PublicCard>
    </PublicPageShell>
  );
}
