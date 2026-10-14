// OWNER: polls-ui.
//
// /p/{slug}/unsubscribe?t={token}: the per-poll unsubscribe page of participant emails (SPEC MP-23, GEN-08). Opening
// the link changes nothing (link scanners are harmless): the page explains what stops and shows an "Unsubscribe"
// button that POSTs to polls-core's /api/public/polls/{slug}/unsubscribe (works without JavaScript), which redirects
// back here with done=1; the confirmation shows only once the participant really is unsubscribed. Invalid tokens and
// deleted polls get a short explanation. Never indexed.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingCard, BookingMainSection } from "@/components/public/booking-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { getOperatorEmail } from "@/components/public/operator";
import { normalizeSlug } from "@/components/polls/server/voter";
import { pt } from "@/components/polls/lib/t";
import { Button } from "@/components/ui/button";
import { getUnsubscribeContext } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

export default async function UnsubscribePage({ params, searchParams }: Props) {
  const [{ slug: raw }, sp] = await Promise.all([params, searchParams]);
  const slug = normalizeSlug(raw);
  if (!slug) notFound();
  const token = one(sp.t)?.slice(0, 300) ?? null;
  const [ctx, operatorEmail] = await Promise.all([token ? getUnsubscribeContext(slug, token) : Promise.resolve(null), getOperatorEmail()]);
  // The stored state decides (a hand-edited ?done=1 never claims an unsubscribe that didn't happen); the form post
  // comes back with ?done=1 after polls-core saved it.
  const done = Boolean(ctx?.unsubscribed);
  const pollHref = `/p/${encodeURIComponent(slug)}`;

  return (
    <PublicPageShell operatorEmail={operatorEmail}>
      <BookingCard ribbon={false} className="min-[600px]:max-w-[560px]">
        <BookingMainSection className="py-12 text-center">
          {!ctx ? (
            <div className="flex flex-col items-center gap-3" data-testid="unsubscribe-invalid">
              <h1 className="text-headline-3 text-public-text">{pt("unsubscribe.invalidHeading")}</h1>
              <p className="max-w-[420px] text-body text-ink-2">{pt("unsubscribe.invalidBody")}</p>
              <Button asChild variant="secondary" className="mt-3">
                <a href={pollHref}>{pt("unsubscribe.openPoll")}</a>
              </Button>
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-3" data-testid="unsubscribe-done" role="status">
              <h1 className="text-headline-3 text-public-text">{pt("unsubscribe.doneHeading")}</h1>
              <p className="max-w-[420px] text-body text-ink-2">{pt("unsubscribe.doneBody", { poll: ctx.pollTitle })}</p>
              <Button asChild variant="secondary" className="mt-3">
                <a href={pollHref}>{pt("unsubscribe.openPoll")}</a>
              </Button>
            </div>
          ) : (
            <form
              method="post"
              action={`/api/public/polls/${encodeURIComponent(slug)}/unsubscribe?t=${encodeURIComponent(token!)}`}
              className="flex flex-col items-center gap-3"
              data-testid="unsubscribe-form"
            >
              <input type="hidden" name="t" value={token!} />
              <h1 className="text-headline-3 text-public-text">{pt("unsubscribe.heading")}</h1>
              <p className="max-w-[440px] text-body text-ink-2">
                {pt("unsubscribe.body", { name: ctx.participantName || "Hi", poll: ctx.pollTitle, host: ctx.hostName })}
              </p>
              <Button type="submit" variant="primary" className="mt-3">
                {pt("unsubscribe.button")}
              </Button>
            </form>
          )}
        </BookingMainSection>
      </BookingCard>
    </PublicPageShell>
  );
}
