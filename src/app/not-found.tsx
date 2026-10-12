// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Root 404 page (SPEC GEN-12, BK-23).
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-24">
      <EmptyState
        heading="This page could not be found."
        body="The link may be broken, or the page may have been removed."
        action={
          <Link href="/" className="text-primary-text underline">
            Go to the home page
          </Link>
        }
      />
    </main>
  );
}
