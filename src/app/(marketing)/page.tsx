// OWNER: marketing-site. Implemented by golden-path-qa: docs/SCOPE.md skips the marketing site (item 15).
//
// / : a signed-in visitor goes to the app (/app/scheduling), a signed-out visitor to the login page; no landing page.
// The session is checked for real (a stale or revoked `sid` cookie counts as signed out); a session still waiting for
// its second factor goes to /login, which sends it on to the challenge.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: true } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function RootPage({ searchParams }: Props): Promise<never> {
  await searchParams;
  const user = await getCurrentUser();
  redirect(user ? "/app/scheduling" : "/login");
}
