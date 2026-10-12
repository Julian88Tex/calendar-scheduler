// OWNER: settings-onboarding.
//
// /app/settings/link, "My Link" (SPEC BR-08, GEN-02; walkthrough 18 "My Link"; docs/SCOPE.md item 14): change the
// public URL ({host}/{slug}) with a live availability check. The old URL stops working at once (no redirect, Calendly
// parity) and is released.
import type { Metadata } from "next";
import { LinkForm } from "@/components/settings/link-form";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getActorCtx } from "@/lib/authz";
import { APP_NAME } from "@/lib/brand";
import { appHost, appUrl } from "@/lib/url";

export const metadata: Metadata = { title: "My Link" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MyLinkPage({ searchParams }: Props) {
  const [actor] = await Promise.all([getActorCtx(), searchParams]);
  return (
    <div className="flex max-w-3xl min-w-0 flex-col">
      <PageHeader title="My Link" />
      <Card padding="lg">
        <LinkForm slug={actor.user.slug} origin={appUrl()} host={appHost()} appName={APP_NAME} />
      </Card>
    </div>
  );
}
