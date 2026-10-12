// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /setup (ARCHITECTURE section 3.1, SPEC GEN-09, ADM-03, ADM-11). In setup mode (VERCEL=1 without a database URL) the
// proxy serves this page's HTML with status 503 for every page request, so in that mode it never touches the database.
// Content: "Finish setting up {AppName}", why a Postgres database is required, the four Vercel steps, the status
// checklist of detected configuration (green or gray "Not configured", with the env var names), the exact OAuth
// redirect URIs to register, background jobs (last cron tick and backlog, instance admins only, once a database
// works) and a link to the optional variables list in the README.
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/ui/copy-button";
import { Logo } from "@/components/ui/logo";
import { setupRequired } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import {
  CRON_STALE_MESSAGE,
  backgroundStatus,
  configurationChecklist,
  oauthRedirectUris,
  optionalVariablesDocsUrl,
  type ChecklistItem,
} from "@/lib/auth/flows/setup-status";
import { isInstanceAdminUser } from "@/lib/authz";
import { APP_NAME } from "@/lib/brand";
import { nowMs } from "@/lib/time/now";

export const metadata: Metadata = { title: "Setup", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STEPS = [
  "Open your project in Vercel",
  "Go to the Storage tab",
  "Create a Neon Postgres database and connect it to this project (all environments)",
  "Redeploy",
];

function StatusIcon({ status }: { status: ChecklistItem["status"] }) {
  if (status === "ok") return <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-success" />;
  if (status === "warning") return <AlertTriangle aria-hidden="true" className="size-5 shrink-0 text-warning-text" />;
  return <CircleDashed aria-hidden="true" className="size-5 shrink-0 text-ink-3" />;
}

const STATUS_WORD: Record<ChecklistItem["status"], string> = { ok: "Configured", off: "Not configured", warning: "Action required" };

// Plain strings, not cn(): tailwind-merge would treat the text-body-md size token as a color and drop it.
const STATUS_TONE: Record<ChecklistItem["status"], string> = { ok: "text-success-text", off: "text-ink-2", warning: "text-warning-text" };

function formatAgo(date: Date, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - date.getTime()) / 60_000));
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

export default async function SetupPage({ searchParams }: Props) {
  await searchParams;
  const needsDatabase = setupRequired();
  const items = configurationChecklist();
  const uris = oauthRedirectUris();
  // Database work only outside setup mode, and the job details only for instance admins.
  const user = needsDatabase ? null : await getCurrentUser().catch(() => null);
  const isAdmin = Boolean(user && isInstanceAdminUser(user));
  const background = isAdmin ? await backgroundStatus() : null;
  const renderedAt = nowMs();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Logo href="/" />
          {!needsDatabase ? (
            <Link href={user ? "/app/scheduling" : "/login"} className="text-body-md font-semibold text-primary-text hover:underline">
              {user ? "Go to Scheduling" : "Log In"}
            </Link>
          ) : null}
        </div>
      </header>
      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
        <div>
          <h1 className="text-headline-3 text-ink sm:text-headline-2">Finish setting up {APP_NAME}</h1>
          <p className="mt-3 text-body text-ink-2">
            {needsDatabase
              ? `${APP_NAME} needs a Postgres database before it can run. Pages show this setup screen and the API answers "setup_required" until one is connected.`
              : `${APP_NAME} is running. Review the configuration below and add any integrations you want to use.`}
          </p>
        </div>

        <section aria-labelledby="setup-steps" className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <h2 id="setup-steps" className="text-title-md text-ink">
            {needsDatabase ? "Connect a database" : "Database"}
          </h2>
          {needsDatabase ? (
            <ol className="mt-4 flex flex-col gap-3">
              {STEPS.map((s, i) => (
                <li key={s} className="flex items-start gap-3 text-body text-ink">
                  <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-label text-white">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{s}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-body-md text-ink-2">The database is connected and migrations run automatically on deploy.</p>
          )}
          <p className="mt-4 text-body-md text-ink-2">
            The Neon integration sets <code className="rounded bg-pebble px-1 py-0.5 text-body-sm">DATABASE_URL</code> for you. Never point a
            deployment at a local database.
          </p>
        </section>

        <section aria-labelledby="setup-config" className="rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-card)]">
          <div className="p-5 pb-3 sm:p-6 sm:pb-3">
            <h2 id="setup-config" className="text-title-md text-ink">
              Configuration
            </h2>
            <p className="mt-1 text-body-md text-ink-2">Detected from the environment variables of this deployment. Every variable is optional.</p>
          </div>
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4 sm:px-6">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <StatusIcon status={item.status} />
                  <div className="min-w-0">
                    <p className="text-label text-ink">
                      {item.label}
                      <span className="sr-only">: {STATUS_WORD[item.status]}</span>
                    </p>
                    {item.hint ? <p className="mt-0.5 text-body-sm text-ink-2">{item.hint}</p> : null}
                    <p className="mt-1 flex flex-wrap gap-1">
                      {item.envVars.map((v) => (
                        <code key={v} className="rounded bg-pebble px-1.5 py-0.5 text-[12px] text-ink-2">
                          {v}
                        </code>
                      ))}
                    </p>
                  </div>
                </div>
                <p className={`pl-8 text-body-md sm:pl-0 sm:text-right ${STATUS_TONE[item.status]}`}>
                  {item.value}
                </p>
              </li>
            ))}
            <li className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4 sm:px-6">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <StatusIcon status={background ? (background.stale ? "warning" : "ok") : "off"} />
                <div className="min-w-0">
                  <p className="text-label text-ink">Background jobs (cron)</p>
                  <p className="mt-0.5 text-body-sm text-ink-2">
                    {background
                      ? background.stale
                        ? CRON_STALE_MESSAGE
                        : `${background.dueJobs} ${background.dueJobs === 1 ? "job is" : "jobs are"} waiting to run.`
                      : needsDatabase
                        ? "Available once a database is connected."
                        : "Log in as an instance admin to see when /api/cron last ran."}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    <code className="rounded bg-pebble px-1.5 py-0.5 text-[12px] text-ink-2">CRON_SECRET</code>
                    <code className="rounded bg-pebble px-1.5 py-0.5 text-[12px] text-ink-2">GET /api/cron</code>
                  </p>
                </div>
              </div>
              <p className={`pl-8 text-body-md sm:pl-0 sm:text-right ${background && !background.stale ? STATUS_TONE.ok : STATUS_TONE.off}`}>
                {background
                  ? background.lastCronAt
                    ? `Last run ${formatAgo(background.lastCronAt, renderedAt)}`
                    : "Never ran"
                  : "Not available"}
              </p>
            </li>
          </ul>
        </section>

        <section aria-labelledby="setup-uris" className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <h2 id="setup-uris" className="text-title-md text-ink">
            OAuth redirect URIs
          </h2>
          <p className="mt-1 text-body-md text-ink-2">
            Register these exact URIs with each provider. They are built from <code className="rounded bg-pebble px-1 py-0.5 text-body-sm">APP_URL</code>, so
            set it to your production domain first.
          </p>
          <ul className="mt-4 flex flex-col gap-4">
            {uris.map((u) => (
              <li key={u.uri} className="flex flex-col gap-2">
                <p className="text-label text-ink">{u.provider}</p>
                <div className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-[var(--radius-input)] border border-line bg-cloud px-3 py-2 text-body-sm text-ink" title={u.uri}>
                    {u.uri}
                  </code>
                  <CopyButton value={u.uri} label="Copy" toastMessage="Copied" size="sm" />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-body-md text-ink-2">
          Every optional variable is listed in the README under{" "}
          <a href={optionalVariablesDocsUrl()} className="inline-flex items-center gap-1 font-semibold text-primary-text hover:underline" rel="noreferrer" target="_blank">
            Optional environment variables
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          .
        </p>
      </main>
    </div>
  );
}
