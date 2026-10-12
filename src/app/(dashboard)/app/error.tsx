// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Dashboard error boundary (SPEC GEN-12): keeps the shell, never shows internals.
"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      heading="Something went wrong."
      body={error.digest ? `Try again. Reference: ${error.digest}` : "Try again."}
      action={<Button onClick={() => reset()}>Try again</Button>}
    />
  );
}
