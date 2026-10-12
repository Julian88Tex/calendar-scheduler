// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Root error boundary (SPEC GEN-12): never shows internals.
"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-24">
      <EmptyState
        heading="Something went wrong."
        body={error.digest ? `Try again. Reference: ${error.digest}` : "Try again."}
        action={<Button onClick={() => reset()}>Try again</Button>}
      />
    </main>
  );
}
