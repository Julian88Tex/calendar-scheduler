// /terms (ARCHITECTURE section 3.1, SPEC MK-03): the participant terms linked from booking pages and the Google consent
// screen. Written for a single-owner deployment (docs/SCOPE.md); plain language, no marketing site.
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { appName } from "@/lib/brand";

export const metadata: Metadata = { title: "Terms of Service" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const UPDATED = "October 15, 2026";

export default async function TermsOfServicePage({ searchParams }: Props) {
  await searchParams;
  const name = appName();
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-16 text-body text-ink">
      <PageHeader title="Terms of Service" />
      <p className="mt-2 text-body-sm text-ink-2">Last updated {UPDATED}</p>
      <div className="mt-8 flex flex-col gap-6 leading-relaxed">
        <section>
          <h2 className="text-title-md font-bold">Using this site</h2>
          <p className="mt-2">
            {name} is a personal scheduling site. By booking a meeting, adding guests or voting in a meeting poll you
            agree to provide accurate details, to add guests only with their permission, and not to use the site to send
            spam or to harass anyone.
          </p>
        </section>
        <section>
          <h2 className="text-title-md font-bold">Meetings</h2>
          <p className="mt-2">
            A booking reserves time with the owner. You can reschedule or cancel from the links in your confirmation
            email. The owner may also reschedule or cancel, and you will be told by email when that happens.
          </p>
        </section>
        <section>
          <h2 className="text-title-md font-bold">No warranty</h2>
          <p className="mt-2">
            The site is provided as is, without any warranty. Calendar invites and emails depend on third party services
            and may occasionally be delayed. Please check your confirmation email for the final meeting details.
          </p>
        </section>
        <section>
          <h2 className="text-title-md font-bold">Privacy</h2>
          <p className="mt-2">
            How your information is handled is described in the <Link className="text-brand-strong underline" href="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      </div>
    </main>
  );
}
