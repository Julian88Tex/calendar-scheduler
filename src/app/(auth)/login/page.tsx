// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /login (ARCHITECTURE section 3.1, SPEC AU-04). Foundation stub: a minimal working email and password form (so the
// seeded owner can sign in); the owner replaces it with the real two-step page and the OAuth buttons.
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { redirectIfSignedIn } from "@/lib/auth/guards";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in to your account", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LogInToYourAccountPage({ searchParams }: Props) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : null;
  await redirectIfSignedIn(next);
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <PageHeader title="Log in to your account" />
      <LoginForm next={next} />
    </main>
  );
}
