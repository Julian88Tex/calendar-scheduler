// OWNER: foundation-ui.
//
// Dashboard error boundary (SPEC GEN-12): keeps the shell, shows "Something went wrong" with "Try again" and never shows
// internals (only the opaque digest as a reference).
"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Illustration } from "@/components/ui/illustration";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      headingLevel={1}
      illustration={<Illustration name="error" />}
      heading="Something went wrong"
      body={
        <>
          This page couldn&apos;t be loaded. Try again in a moment.
          {error.digest && <span className="mt-2 block text-body-sm">Reference: {error.digest}</span>}
        </>
      }
      action={<Button onClick={() => reset()}>Try again</Button>}
    />
  );
}
