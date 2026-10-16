// OWNER: marketing-site. Implemented by golden-path-qa: docs/SCOPE.md skips the marketing site (item 15).
//
// / : a signed-in visitor goes to the app (/app/scheduling). Everyone else sees the app's home page: what the app is,
// a big "Sign in" button, and the page Google's OAuth app verification asks for (a page on the app's domain that
// describes the app and links its privacy policy; a login page alone is rejected, docs/GOOGLE_VERIFICATION.md): how it
// uses Google and the Privacy Policy and Terms links. It names no account holder: people book through a host's own
// link (/{handle}), so the root is the app's front door, not anyone's profile. The session is checked for real (a stale
// or revoked `sid` cookie counts as signed out); a session still waiting for its second factor sees the page too, and
// "Sign in" sends it on to the challenge. Indexable.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { buttonClassName } from "@/components/ui/button";
import { LogoMark } from "@/components/ui/logo";
import { getCurrentUser } from "@/lib/auth/session";
import { appName } from "@/lib/brand";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const product = appName();
  return {
    title: { absolute: product },
    description: `${product} is a scheduling app: people book meetings on your booking page and answer your meeting polls.`,
  };
}

const LINK = "font-semibold text-primary-text underline-offset-2 hover:underline";

export default async function RootPage({ searchParams }: Props) {
  await searchParams;
  const user = await getCurrentUser();
  if (user) redirect("/app/scheduling");

  const product = appName();

  return (
    <PublicPageShell>
      <PublicCard width="narrow" ribbon={false}>
        <section aria-labelledby="home-title" className="flex flex-col items-center px-6 pt-10 pb-8 text-center min-[600px]:px-12">
          <LogoMark size={56} />
          <h1 id="home-title" className="mt-4 text-[28px] leading-9 font-bold tracking-[-0.4px] text-ink">
            {product}
          </h1>
          <p className="mt-3 max-w-[460px] text-[16px] leading-6 text-ink-2">
            {`${product} is a scheduling app. People pick a free time on your booking page and it lands on your calendar, and meeting polls let a group vote on a time. Invitees never need an account.`}
          </p>
          <Link href="/login" className={buttonClassName({ size: "lg", className: "mt-6 min-w-[200px]" })}>
            Sign in
          </Link>
          <p className="mt-3 text-[14px] leading-5 text-ink-2">Booking a meeting? Use the link your host sent you.</p>
        </section>

        <section aria-labelledby="home-google" className="border-t border-line px-6 py-6 text-[14px] leading-[22px] text-ink-2 min-[600px]:px-12">
          <h2 id="home-google" className="text-[16px] leading-6 font-bold text-ink">
            How it uses Google
          </h2>
          <p className="mt-2">
            {`${product} connects to the host's Google account to check their Google Calendar for busy times, so you are only offered times that are free; to add booked meetings to that calendar with a Google Meet link; and to send the booking emails (confirmations, reminders, reschedules and cancellations) from their Gmail address, a permission that can only send messages and never read mail. If you answer a meeting poll, you can choose to check your own Google Calendar's free and busy times; that access is used once and not stored.`}
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
