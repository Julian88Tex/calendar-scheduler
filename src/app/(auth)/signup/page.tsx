// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /signup (ARCHITECTURE section 3.1, SPEC AU-01). Foundation stub: a minimal working one-step form through
// createUserAccount; the owner replaces it with the real two-column, two-step page and the OAuth buttons.
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { redirectIfSignedIn } from "@/lib/auth/guards";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create a free account", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CreateAFreeAccountPage({ searchParams }: Props) {
  const sp = await searchParams;
  await redirectIfSignedIn(typeof sp.next === "string" ? sp.next : null);
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <PageHeader title="Create a free account" description="No credit card required." />
      <SignupForm />
    </main>
  );
}
