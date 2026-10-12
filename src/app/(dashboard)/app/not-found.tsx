// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Dashboard 404 (inside the shell).
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";

export default function DashboardNotFound() {
  return (
    <EmptyState
      heading="This page could not be found."
      action={
        <Link href="/app/scheduling" className="text-primary-text underline">
          Back to Scheduling
        </Link>
      }
    />
  );
}
