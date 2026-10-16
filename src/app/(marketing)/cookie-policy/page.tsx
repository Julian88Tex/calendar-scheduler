// OWNER: marketing-site. Written for the single-owner deployment.
// /cookie-policy (ARCHITECTURE section 3.1, SPEC MK-03): every cookie the app sets (src/lib/auth/session.ts,
// src/lib/auth/oauth/state.ts, src/lib/booking/verification.ts, src/lib/polls/constants.ts, src/components/shell/theme.ts)
// with its purpose and lifetime, what is kept in the browser's local storage instead (the cookie choice, display
// preferences), and how "Cookie settings" works. No analytics or advertising trackers are configured
// (src/components/analytics/trackers.tsx loads nothing). Plain language, linked from the sitemap.
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { appName } from "@/lib/brand";
import { CookieSettingsButton } from "./cookie-settings-button";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "The cookies this scheduling site sets, why, and for how long.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const UPDATED = "October 16, 2026";

type CookieRow = { names: string[]; purpose: string; lifetime: string };

const COOKIES: CookieRow[] = [
  {
    names: ["sid"],
    purpose:
      "Keeps the owner signed in to the scheduling dashboard. It is set only when someone logs in; people who book a meeting or vote in a poll never get it.",
    lifetime: "Kept by the browser for up to 400 days, but the sign in it holds ends after 30 days without use or when you log out.",
  },
  {
    names: ["kairos_oauth"],
    purpose:
      'Protects the "Continue with Google" step (signing in, connecting a calendar, or "Check my calendar" on a meeting poll) against forged requests while you are on Google\'s page. It is only sent back to the sign in pages.',
    lifetime: "10 minutes, and it is deleted as soon as you come back from Google.",
  },
  {
    names: ["kairos_trusted_device"],
    purpose:
      'Set only when the owner asks invitees to confirm their email address with a code and you tick "Remember this device": you then skip the code the next time you book from this browser with the same email.',
    lifetime: "365 days.",
  },
  {
    names: ["kairos_poll_edit", "kairos_poll_edit_api"],
    purpose:
      'Set when you answer a meeting poll, so you can change your answers later from the same browser ("Edit your preferred times"). They only work for that poll.',
    lifetime: "365 days.",
  },
  {
    names: ["kairos_poll_freebusy"],
    purpose:
      'Holds the result of "Check my calendar" on a meeting poll while you vote: only whether each proposed time is free or busy for you, never the titles or details of your events.',
    lifetime: "30 minutes.",
  },
  {
    names: ["kairos_compare"],
    purpose:
      'Set only when you choose "Compare with my calendar" on a booking page and connect Google: it holds your Google access, encrypted, so the page can show which times clash with your calendar. It is sent only to the compare service, and "Disconnect" deletes it.',
    lifetime: "As long as Google allows the access, at most 1 hour.",
  },
  {
    names: ["kairos_theme"],
    purpose: "Remembers the owner's appearance setting (light or dark) in the dashboard. It is not used on booking or poll pages.",
    lifetime: "1 year.",
  },
];

export default async function CookiePolicyPage({ searchParams }: Props) {
  await searchParams;
  const name = appName();
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-16 text-body text-ink">
      <PageHeader title="Cookie Policy" />
      <p className="mt-2 text-body-sm text-ink-2">Last updated {UPDATED}</p>
      <div className="mt-8 flex flex-col gap-6 leading-relaxed">
        <section>
          <h2 className="text-title-md font-bold">In short</h2>
          <p className="mt-2">
            {name} is a personal scheduling site run by its owner. It only sets the cookies it needs to work: to keep the
            owner signed in, to protect sign in with Google, and to remember a few choices you make while booking or
            voting. It uses no analytics, advertising or tracking cookies, and nothing about your visit is shared with
            advertisers.
          </p>
        </section>

        <section aria-labelledby="cookies-we-set">
          <h2 id="cookies-we-set" className="text-title-md font-bold">
            Cookies this site sets
          </h2>
          <p className="mt-2">
            All of them are first party (set by this site only) and needed for the feature they belong to. None of
            them follows you to other websites.
          </p>
          <ul className="mt-4 flex flex-col gap-4">
            {COOKIES.map((c) => (
              <li key={c.names.join(",")} className="rounded-[var(--radius-card)] border border-line bg-white p-4">
                <p className="flex flex-wrap gap-2">
                  {c.names.map((n) => (
                    <code key={n} className="rounded bg-pebble px-1.5 py-0.5 text-body-sm break-all text-ink">
                      {n}
                    </code>
                  ))}
                </p>
                <p className="mt-2">{c.purpose}</p>
                <p className="mt-1 text-body-md text-ink-2">
                  <span className="font-semibold text-ink">How long: </span>
                  {c.lifetime}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-4">
            When a booking or poll page is embedded on another website and your browser blocks cookies there, the same
            values are kept in that browser&apos;s local storage instead, for the same time.
          </p>
        </section>

        <section>
          <h2 className="text-title-md font-bold">Kept in your browser, not in cookies</h2>
          <p className="mt-2">
            A few preferences stay in your browser&apos;s local storage. They are never sent to the server on their own:
          </p>
          <ul className="mt-2 list-disc pl-6">
            <li>Your cookie choice from Cookie settings, for 365 days.</li>
            <li>On booking pages: whether you prefer the am/pm or the 24 hour clock.</li>
            <li>
              Your name and email, to fill in the booking form next time, only on meeting types where the owner turned
              this on.
            </li>
            <li>In the owner&apos;s dashboard: display choices such as dismissed notices.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-title-md font-bold">Analytics and advertising</h2>
          <p className="mt-2">
            None. This site does not load Google Analytics, a Meta Pixel or any other analytics or advertising tool.
            Server logs keep basic technical data (such as your IP address and browser) to run the site safely, as
            described in the <Link className="text-brand-strong underline" href="/privacy">Privacy Policy</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-title-md font-bold">Cookie settings</h2>
          <p className="mt-2">
            The <strong>Cookie settings</strong> link at the bottom of booking and meeting poll pages opens a window with
            three groups: <strong>Strictly necessary</strong> (the cookies above, always on), <strong>Analytics</strong>{" "}
            and <strong>Marketing</strong> (both off unless you turn them on). Choose <strong>Accept all</strong>,{" "}
            <strong>Reject non-essential</strong> or set the switches and <strong>Confirm my choices</strong>. Your choice
            is saved in your browser for 365 days and you can change it at any time. As no analytics or marketing tools
            are in use, turning those groups on changes nothing today; the choice is kept in case that ever changes.
          </p>
          <div className="mt-4">
            <CookieSettingsButton />
          </div>
        </section>

        <section>
          <h2 className="text-title-md font-bold">Removing cookies</h2>
          <p className="mt-2">
            You can delete or block these cookies in your browser settings at any time. Without them, signing in, the
            email code step or editing your poll answers may not work, and you may be asked to confirm your email again.
          </p>
        </section>

        <section>
          <h2 className="text-title-md font-bold">Questions</h2>
          <p className="mt-2">
            Reply to any booking or meeting poll email to reach the owner. How your information is handled is described
            in the <Link className="text-brand-strong underline" href="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      </div>
    </main>
  );
}
