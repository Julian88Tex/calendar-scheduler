// OWNER: marketing-site. Implemented by golden-path-qa: docs/SCOPE.md skips the marketing site (item 15).
//
// / : a signed-in visitor goes to the app (/app/scheduling). Everyone else sees the public home page Google's OAuth app
// verification asks for (a page on the app's domain that describes the app and links its privacy policy; a login page
// alone is rejected, docs/GOOGLE_VERIFICATION.md): the owner's name and photo, what this site is, how it uses Google,
// a button to the owner's booking page and a "Sign in" link. The session is checked for real (a stale or revoked `sid`
// cookie counts as signed out); a session still waiting for its second factor sees the page too, and "Sign in" sends
// it on to the challenge. Single owner instance (docs/SCOPE.md): the owner is the first instance admin, the account
// email services send from (src/lib/email/gmail-sender.ts getInstanceOwner). Without one (a fresh instance, or no
// database yet) the page still renders, with the product name and without the booking button. Indexable.
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cache } from "react";
import { avatarOf } from "@/components/booking/server/host";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { Avatar } from "@/components/ui/avatar";
import { buttonClassName } from "@/components/ui/button";
import { LogoMark } from "@/components/ui/logo";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { appName } from "@/lib/brand";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

type HomeOwner = { name: string; avatarUrl: string | null; slug: string | null };

/** The instance owner shown on the home page, or null (no account yet, or the database is unavailable). */
const loadHomeOwner = cache(async (): Promise<HomeOwner | null> => {
  try {
    const db = await getDb();
    const [u] = await db
      .select({ name: users.name, slug: users.slug, avatarUrl: users.avatarUrl, avatarFileId: users.avatarFileId })
      .from(users)
      .where(and(eq(users.isInstanceAdmin, true), isNull(users.deletedAt)))
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(1);
    if (!u) return null;
    return { name: u.name?.trim() || appName(), avatarUrl: avatarOf(u), slug: u.slug?.trim() || null };
  } catch (e) {
    log.warn("home.owner_unavailable", { error: e });
    return null;
  }
});

export async function generateMetadata(): Promise<Metadata> {
  const product = appName();
  const owner = await loadHomeOwner();
  const who = owner && owner.name !== product ? `${owner.name}'s` : "A";
  return {
    title: { absolute: owner && owner.name !== product ? `${owner.name} | ${product}` : product },
    description: `${who} personal scheduling site. Book a meeting or answer a meeting poll.`,
  };
}

const LINK = "font-semibold text-primary-text underline-offset-2 hover:underline";

export default async function RootPage({ searchParams }: Props) {
  await searchParams;
  const user = await getCurrentUser();
  if (user) redirect("/app/scheduling");

  const product = appName();
  const owner = await loadHomeOwner();
  const name = owner?.name ?? product;
  const named = Boolean(owner && owner.name !== product);
  const site = named ? `${name}'s personal scheduling site` : "a personal scheduling site";
  const whose = named ? `${name}'s` : "the owner's";
  const bookingHref = owner?.slug ? (`/${encodeURIComponent(owner.slug)}` as Route) : null;

  return (
    <PublicPageShell>
      <PublicCard width="narrow" ribbon={false}>
        <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <span className="inline-flex min-w-0 items-center gap-2 text-ink">
            <LogoMark size={28} />
            <span className="truncate text-[18px] leading-none font-bold tracking-[-0.3px]">{product}</span>
          </span>
          <Link href="/login" className={buttonClassName({ variant: "tertiary", size: "sm" })}>
            Sign in
          </Link>
        </header>

        <section aria-labelledby="home-title" className="flex flex-col items-center px-6 pt-8 pb-8 text-center min-[600px]:px-12">
          <Avatar src={owner?.avatarUrl ?? null} name={name} alt="" size={65} />
          <h1 id="home-title" className="mt-4 text-[20px] leading-7 font-bold break-words text-ink">
            {name}
          </h1>
          <p className="mt-3 max-w-[460px] text-[16px] leading-6 text-ink-2">
            {`This is ${site}, built with ${product}, where people book meetings and answer meeting polls.`}
          </p>
          {bookingHref && (
            <Link href={bookingHref} className={buttonClassName({ size: "lg", className: "mt-6" })}>
              Book a meeting
            </Link>
          )}
        </section>

        <section aria-labelledby="home-google" className="border-t border-line px-6 py-6 text-[14px] leading-[22px] text-ink-2 min-[600px]:px-12">
          <h2 id="home-google" className="text-[16px] leading-6 font-bold text-ink">
            How it uses Google
          </h2>
          <p className="mt-2">
            {`${product} connects to ${whose} Google account to check their Google Calendar for busy times, so you are only offered times that are free; to add booked meetings to that calendar with a Google Meet link; and to send the booking emails (confirmations, reminders, reschedules and cancellations) from their Gmail address, a permission that can only send messages and never read mail. If you answer a meeting poll, you can choose to check your own Google Calendar's free and busy times; that access is used once and not stored.`}
          </p>
          <p className="mt-2">
            Google data is used only for scheduling: it is never sold, shared with anyone else or used to train AI models.
            Read the{" "}
            <Link href="/privacy" className={LINK}>
              Privacy Policy
            </Link>{" "}
            and the{" "}
            <Link href="/terms" className={LINK}>
              Terms of Service
            </Link>
            .
          </p>
        </section>
      </PublicCard>
    </PublicPageShell>
  );
}
