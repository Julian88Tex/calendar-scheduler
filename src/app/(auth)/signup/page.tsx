// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /signup (ARCHITECTURE section 3.1, SPEC AU-01, AU-11, walkthrough 3.1): two columns at 768px and up, the
// illustration panel on the left and the form card on the right ("Create a free account", "No credit card
// required."). When nobody can sign up without an invitation the card shows "Sign ups are closed. Ask an admin for an
// invitation." instead of the form. ?error= shows an OAuth callback message. Signed-in visitors go to Scheduling.
import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { Logo } from "@/components/ui/logo";
import { redirectIfSignedIn } from "@/lib/auth/guards";
import { oauthErrorFromSearchParams, oauthErrorMessage } from "@/lib/auth/oauth/errors";
import { getSignupAvailability, SIGNUPS_CLOSED_MESSAGE } from "@/lib/auth/policy";
import { getFeatures } from "@/lib/env";
import { SignupIllustration, SignupPitch } from "../_components/signup-illustration";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create a free account", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CreateAFreeAccountPage({ searchParams }: Props) {
  const sp = await searchParams;
  await redirectIfSignedIn(typeof sp.next === "string" ? sp.next : null);
  const availability = await getSignupAvailability();
  const features = getFeatures();
  const oauthError = oauthErrorFromSearchParams(sp);
  const initialError = oauthError ? oauthErrorMessage(oauthError.code, { provider: oauthError.provider }) : null;

  return (
    <div className="flex min-h-screen bg-white">
      <aside className="hidden w-[46%] max-w-[720px] flex-col justify-center gap-16 bg-primary-soft px-10 py-16 md:flex lg:px-16">
        <SignupPitch />
        <SignupIllustration />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center px-4 py-5 sm:px-8">
          <Logo href="/" />
        </header>
        <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center sm:px-8">
          <div className="w-full max-w-[440px]">
            <div className="rounded-[var(--radius-card)] border border-line bg-white px-5 py-8 shadow-[var(--shadow-card)] sm:px-10 sm:py-10">
              <h1 className="text-center text-headline-3 text-ink">Create a free account</h1>
              <p className="mt-2 text-center text-body-md text-ink-2">No credit card required.</p>
              <div className="mt-8">
                {availability.open ? (
                  <SignupForm providers={{ google: features.googleOAuth, microsoft: features.microsoftOAuth }} initialError={initialError} />
                ) : (
                  <div className="flex flex-col gap-4">
                    <Banner variant="info">{SIGNUPS_CLOSED_MESSAGE}</Banner>
                    {initialError && oauthError?.code !== "signups_closed" ? <Banner variant="error">{initialError}</Banner> : null}
                  </div>
                )}
              </div>
            </div>
            <p className="mt-6 text-center text-body-md text-ink-2">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-primary-text hover:underline">
                Log In
              </Link>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
