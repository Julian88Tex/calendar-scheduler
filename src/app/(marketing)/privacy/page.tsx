// /privacy (ARCHITECTURE section 3.1, SPEC MK-03): the privacy notice linked from booking pages, emails and the Google
// consent screen. Written for a single-owner deployment (docs/SCOPE.md); plain language, no marketing site.
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { appName } from "@/lib/brand";

export const metadata: Metadata = { title: "Privacy Policy" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const UPDATED = "October 15, 2026";

export default async function PrivacyPolicyPage({ searchParams }: Props) {
  await searchParams;
  const name = appName();
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-16 text-body text-ink">
      <PageHeader title="Privacy Policy" />
      <p className="mt-2 text-body-sm text-ink-2">Last updated {UPDATED}</p>
      <div className="mt-8 flex flex-col gap-6 leading-relaxed">
        <section>
          <h2 className="text-title-md font-bold">Who runs this site</h2>
          <p className="mt-2">
            {name} is a personal scheduling site run by its owner to let people book meetings with them. It is not a
            commercial service. Questions about this notice go to the owner at the email address shown in your booking
            confirmation.
          </p>
        </section>
        <section>
          <h2 className="text-title-md font-bold">What we collect when you book or vote</h2>
          <ul className="mt-2 list-disc pl-6">
            <li>Your name, email address and the email addresses of any guests you add.</li>
            <li>Your answers to the booking questions, the location you pick and the time zone shown to you.</li>
            <li>Meeting poll votes and comments, if you take part in a poll.</li>
            <li>Basic technical data needed to run the site safely (IP address and browser details in server logs).</li>
          </ul>
        </section>
        <section>
          <h2 className="text-title-md font-bold">How it is used</h2>
          <p className="mt-2">
            Only to schedule the meeting: to show it on the owner&apos;s calendar, send you the confirmation, reminder,
            reschedule and cancellation emails with calendar invites, and let you reschedule or cancel. Your data is not
            sold, rented or used for advertising.
          </p>
        </section>
        <section>
          <h2 className="text-title-md font-bold">Google data</h2>
          <p className="mt-2">
            The owner connects their own Google account so the site can check their calendar for busy times, add the
            meeting with a Google Meet link, and send booking emails from their Gmail address. The Gmail permission can
            only send messages; it cannot read, change or delete mail. Google user data is used only for these purposes
            and is never shared with anyone else or used to train AI models. The use of information received from Google
            APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. If you check
            your own Google calendar while voting in a meeting poll, the site reads only your free and busy times for
            that check and does not store your calendar access.
          </p>
        </section>
        <section>
          <h2 className="text-title-md font-bold">Who else processes it</h2>
          <p className="mt-2">
            The site runs on Vercel and stores data in a Neon Postgres database. Calendar events and emails go through
            Google. These providers process data only to provide their service.
          </p>
        </section>
        <section>
          <h2 className="text-title-md font-bold">How long it is kept and your choices</h2>
          <p className="mt-2">
            Meeting records are kept so the owner can see their meeting history. You can cancel a meeting at any time
            from the link in your emails, and you can ask the owner to delete your data by replying to any booking email.
          </p>
        </section>
      </div>
    </main>
  );
}
