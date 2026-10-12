// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/dev/ui: the UI kit gallery (ARCHITECTURE 20.2). foundation-ui showcases every component and state here; the
// foundation stub shows a minimal set. Signed-in users only (the dashboard layout); not indexed.
import type { Metadata } from "next";
import { DevGallery } from "./gallery";

export const metadata: Metadata = { title: "UI kit", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DevUiPage({ searchParams }: Props) {
  await searchParams;
  return <DevGallery />;
}
