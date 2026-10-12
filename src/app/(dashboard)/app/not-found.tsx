// OWNER: foundation-ui.
//
// Dashboard 404 (SPEC GEN-12), inside the shell.
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Illustration } from "@/components/ui/illustration";

export const metadata: Metadata = { title: "Page not found" };

export default function DashboardNotFound() {
  return (
    <EmptyState
      headingLevel={1}
      illustration={<Illustration name="not-found" />}
      heading="Page not found"
      body="This link isn't valid. Check the URL or go back to Scheduling."
      action={
        <Link href="/app/scheduling" className={buttonClassName({ variant: "primary" })}>
          Go to Scheduling
        </Link>
      }
    />
  );
}
