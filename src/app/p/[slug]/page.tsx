// OWNER: polls-ui.
//
// /p/{slug}: the public meeting poll voter page (SPEC MP-07 to MP-15, MP-29, MP-30; research meeting-polls.md B5).
// Unknown slugs are the standard 404 page; old link endings redirect to the canonical slug (keeping the edit cookie
// through the magic edit path); a deleted poll shows "This poll is no longer available." without any details (the
// public JSON API answers 410). Never indexed, frameable (/p/** frame policy), rendered in the public shell with the
// owner's branding and embed display parameters.
import type { Metadata } from "next";
import type { Route } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { cache } from "react";
import { BookingCard, BookingMainSection } from "@/components/public/booking-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { loadVoterPage, voterMetadataTitle, type SearchParams } from "@/components/polls/server/voter";
import { pt } from "@/components/polls/lib/t";
import { MessagePanel } from "@/components/polls/voter/state-panels";
import { VoterPage } from "@/components/polls/voter/voter-page";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const NOINDEX = { index: false, follow: false } as const;

/** One load per request for generateMetadata and the page. */
const load = cache((slug: string, query: string) => loadVoterPage(slug, Object.fromEntries(new URLSearchParams(query)) as SearchParams));

function queryOf(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string") q.set(k, s);
  }
  return q.toString();
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const r = await load(slug, queryOf(sp));
  if (r.kind !== "ok") return { title: r.kind === "gone" ? pt("voter.canceledTitle") : "Meeting poll", robots: NOINDEX };
  const meta = voterMetadataTitle(r.props.view);
  return {
    title: meta.title,
    description: "Vote on times for this meeting",
    robots: NOINDEX,
    openGraph: { title: meta.ogTitle, description: "Vote on times for this meeting" },
  };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const r = await load(slug, queryOf(sp));
  if (r.kind === "not_found") notFound();
  if (r.kind === "redirect") {
    if (r.permanent) permanentRedirect(r.to as Route);
    redirect(r.to as Route);
  }
  if (r.kind === "gone") {
    return (
      <PublicPageShell branding={r.shell.branding} embed={r.shell.embed} hideGdprBanner={r.shell.hideGdprBanner} operatorEmail={r.shell.operatorEmail} privacyUrl={r.shell.privacyUrl}>
        <BookingCard ribbon={false} embed={r.shell.embed}>
          <BookingMainSection className="py-16">
            <MessagePanel kind="canceled" title={pt("voter.canceledTitle")} hint={pt("voter.canceledHint")} />
          </BookingMainSection>
        </BookingCard>
      </PublicPageShell>
    );
  }
  const { props } = r;
  return (
    <PublicPageShell
      branding={props.shell.branding}
      embed={props.shell.embed}
      showFooterLinks={false}
      hideGdprBanner={props.shell.hideGdprBanner}
      operatorEmail={props.shell.operatorEmail}
      privacyUrl={props.shell.privacyUrl}
    >
      <VoterPage {...props} />
    </PublicPageShell>
  );
}
