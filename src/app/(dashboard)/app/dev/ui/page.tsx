// OWNER: foundation-ui.
//
// /app/dev/ui: the UI kit gallery (ARCHITECTURE 20.2): every component and state, plus replicas of the public booking
// page and landing page built from the public components (visual parity checks against the owner's screenshots).
// Signed-in users only (the dashboard layout); available outside production, in E2E mode and to instance admins.
// Not indexed.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActorCtx } from "@/lib/authz";
import { isE2eMode, isProd } from "@/lib/env";
import { DevGallery } from "./gallery";

export const metadata: Metadata = { title: "UI kit", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DevUiPage({ searchParams }: Props) {
  const [, actor] = await Promise.all([searchParams, getActorCtx()]);
  if (isProd() && !isE2eMode() && !actor.isInstanceAdmin) notFound();
  return <DevGallery />;
}
