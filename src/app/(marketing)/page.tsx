// OWNER: marketing-site. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// / placeholder (ARCHITECTURE section 3.1, SPEC MK-01): the signed-out landing page. The owner replaces it with the
// real page (signed-in users then redirect to /app/scheduling).
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { APP_NAME } from "@/lib/brand";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MarketingHomePage({ searchParams }: Props) {
  await searchParams;
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-16">
      <PageHeader title={APP_NAME} description="Scheduling without the back and forth." />
      <EmptyState
        heading="This page is being built."
        action={
          <Link href="/login" className={buttonClassName()}>
            Log in
          </Link>
        }
      />
    </main>
  );
}
