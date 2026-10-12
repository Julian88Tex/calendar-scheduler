// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /setup placeholder (ARCHITECTURE section 3.1, SPEC GEN-09). In setup mode (VERCEL=1 without a database URL) the proxy
// serves this page's HTML with status 503 for every page request, so it must never touch the database. The foundation
// stub has the final title and the numbered steps; the owner adds the status checklist of detected configuration and
// the exact OAuth redirect URIs.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Setup", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STEPS = [
  "Open your project in Vercel",
  "Go to the Storage tab",
  "Create a Neon Postgres database and connect it to this project (all environments)",
  "Redeploy",
];

export default async function SetupPage({ searchParams }: Props) {
  await searchParams;
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-16">
      <PageHeader title={`Finish setting up ${APP_NAME}`} description={`${APP_NAME} needs a Postgres database before it can run.`} />
      <ol className="mb-8 list-decimal pl-6 text-body-md">
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <EmptyState heading="This page is being built." />
    </main>
  );
}
