// OWNER: marketing-site. Written for the single-owner deployment.
// /help (ARCHITECTURE section 3.1, SPEC GEN-19, MK-04): help for the people who book with the owner or answer the
// owner's meeting polls: booking, rescheduling and canceling (from the links in the emails), time zones, meeting polls
// and how to reach the owner (reply to any booking email; there is no separate support address). The owner's own help
// lives in the dashboard's Help center (src/components/shell/help-center.tsx). Plain language, linked from the
// sitemap.
import type { Metadata } from "next";
import Link from "next/link";
import type * as React from "react";
import { PageHeader } from "@/components/ui/page-header";
import { appName } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Help center",
  description: "How to book, reschedule or cancel a meeting, pick your time zone and answer a meeting poll.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

type Topic = { id: string; title: string; body: React.ReactNode };

export default async function HelpCenterPage({ searchParams }: Props) {
  await searchParams;
  const name = appName();
  const topics: Topic[] = [
    {
      id: "book",
      title: "Book a meeting",
      body: (
        <>
          <ol className="mt-2 list-decimal pl-6">
            <li>Open the booking link the owner shared with you and choose a meeting type.</li>
            <li>Pick a day on the calendar, then one of the available times, and click <strong>Next</strong>.</li>
            <li>
              Enter your name and email, answer the questions and, for an in person meeting, choose where to meet.
              You can add guests if the meeting type allows it.
            </li>
            <li>
              Click <strong>Schedule Event</strong>. The page shows &quot;You are scheduled&quot; and a confirmation
              email with a calendar invitation is on its way. Video meetings include their Google Meet link.
            </li>
          </ol>
          <p className="mt-2">
            Only open times are shown: times taken by other meetings or blocked on the owner&apos;s calendar never
            appear. If someone books your time a moment before you, the page says so and shows the remaining times. If
            the owner asks invitees to confirm their email address, you get a 6 digit code by email to finish booking.
          </p>
        </>
      ),
    },
    {
      id: "reschedule-cancel",
      title: "Reschedule or cancel",
      body: (
        <>
          <p className="mt-2">
            Every confirmation and reminder email ends with &quot;Need to make changes to this event?&quot; and two
            links, <strong>Cancel</strong> and <strong>Reschedule</strong>. The confirmation page has the same links.
          </p>
          <ul className="mt-2 list-disc pl-6">
            <li>
              <strong>Reschedule</strong> opens the calendar so you can pick a new time. Your old time is released and
              everyone receives an updated invitation.
            </li>
            <li>
              <strong>Cancel</strong> asks you to confirm with <strong>Cancel Event</strong>; you can add a reason for
              the owner. The meeting is removed from the calendars and you receive a cancellation email.
            </li>
          </ul>
          <p className="mt-2">
            The links are personal to your booking, so keep the email. If the owner changes or cancels the meeting, you
            are told by email.
          </p>
        </>
      ),
    },
    {
      id: "time-zones",
      title: "Time zones",
      body: (
        <>
          <p className="mt-2">
            Booking pages show times in the time zone of your device, detected automatically. To see them in another
            zone, for example before a trip, change the <strong>Time zone</strong> menu under the calendar. You can also
            switch between the am/pm and the 24 hour clock there.
          </p>
          <p className="mt-2">
            Your confirmation and reminder emails use the time zone you booked in, and the calendar invitation adjusts to
            whatever zone your calendar app is set to.
          </p>
        </>
      ),
    },
    {
      id: "polls",
      title: "Meeting polls",
      body: (
        <>
          <p className="mt-2">
            When the owner needs to find a time that suits several people, they send a meeting poll link instead of a
            booking link.
          </p>
          <ol className="mt-2 list-decimal pl-6">
            <li>Open the link and select every proposed time that works for you.</li>
            <li>
              Optionally click <strong>Check my calendar</strong> to see which times are busy for you. Only free and
              busy times are read; your event details are never stored.
            </li>
            <li>
              Click <strong>Share times</strong>, enter your name and email, then click <strong>Share times</strong>{" "}
              again. If nothing works, choose <strong>None of these work for me</strong>.
            </li>
          </ol>
          <p className="mt-2">
            To change your answers later, open the link again in the same browser and choose{" "}
            <strong>Edit your preferred times</strong>. From another browser, vote again with the same email: you get an
            email with a link to update your answers. When the owner picks the final time, you receive a calendar
            invitation.
          </p>
        </>
      ),
    },
    {
      id: "contact",
      title: "Contact the owner",
      body: (
        <p className="mt-2">
          {name} is the owner&apos;s personal scheduling site, so there is no separate support desk. To ask a question,
          change something that the links above cannot, or have your details removed, reply to any booking, reminder or
          meeting poll email: your reply goes straight to the owner.
        </p>
      ),
    },
  ];

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-16 text-body text-ink">
      <PageHeader title="Help center" description={`Booking, rescheduling and meeting polls on ${name}.`} />
      <nav aria-label="Help topics" className="mt-2">
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {topics.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} className="text-body-md font-semibold text-brand-strong hover:underline">
                {t.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-8 flex flex-col gap-8 leading-relaxed">
        {topics.map((t) => (
          <section key={t.id} id={t.id} aria-labelledby={`${t.id}-title`} className="scroll-mt-6">
            <h2 id={`${t.id}-title`} className="text-title-md font-bold">
              {t.title}
            </h2>
            {t.body}
          </section>
        ))}
        <p className="text-body-md text-ink-2">
          See also the <Link className="text-brand-strong underline" href="/privacy">Privacy Policy</Link>, the{" "}
          <Link className="text-brand-strong underline" href="/cookie-policy">Cookie Policy</Link> and the{" "}
          <Link className="text-brand-strong underline" href="/terms">Terms of Service</Link>.
        </p>
      </div>
    </main>
  );
}
