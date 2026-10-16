// OWNER: workflows.
//
// /reconfirm/{inviteeId} (SPEC NT-18): reconfirmation requests are not part of this build (docs/SCOPE.md: workflows lite
// sends email reminders only, no reconfirmation templates), so no reminder ever links here; the route answers 404 for
// every invitee. Never framed (frame-ancestors 'none', src/lib/net/frame-policy.ts).
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ inviteeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  await Promise.all([params, searchParams]);
  notFound();
}
