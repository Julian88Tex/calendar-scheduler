// Configuration status for the setup page (SPEC GEN-09, ADM-03, ADM-11): one row per integration with green
// "configured" or gray "Not configured", the env var names to set, the exact OAuth redirect URIs, and (only when a
// database is reachable) the last cron tick and the job backlog. configurationChecklist() reads the environment only,
// so the setup page can render it without a database (setup mode). Integrations outside the reduced scope
// (docs/SCOPE.md: Zoom, SMS, payments) are not listed.
import "server-only";
import { and, count, eq, lte } from "drizzle-orm";
import { getDb, setupRequired } from "@/db";
import { instanceSettings, jobs } from "@/db/schema";
import { appName } from "@/lib/brand";
import { getEnv, getFeatures } from "@/lib/env";
import { now } from "@/lib/time/now";
import { appUrl } from "@/lib/url";
import { GOOGLE_REDIRECT_PATH, MICROSOFT_REDIRECT_PATH } from "../oauth/clients";

export type ChecklistStatus = "ok" | "off" | "warning";

export type ChecklistItem = {
  id: string;
  label: string;
  status: ChecklistStatus;
  /** "Connected", "Not configured", "Outbox only", ... */
  value: string;
  /** Env vars that configure it. */
  envVars: string[];
  /** One sentence of help. */
  hint?: string;
};

export type RedirectUri = { provider: string; uri: string; envVars: string[] };

/** The exact redirect URIs to register (built from APP_URL, never VERCEL_URL). */
export function oauthRedirectUris(): RedirectUri[] {
  const base = appUrl();
  return [
    { provider: "Google (sign in, Calendar, Meet)", uri: `${base}${GOOGLE_REDIRECT_PATH}`, envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] },
    {
      provider: "Microsoft (sign in)",
      uri: `${base}${MICROSOFT_REDIRECT_PATH}`,
      envVars: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT"],
    },
  ];
}

/** The GEN-09 checklist from the environment (never touches the database). */
export function configurationChecklist(): ChecklistItem[] {
  const e = getEnv();
  const f = getFeatures(e);
  const onVercel = Boolean(e.VERCEL);
  const app = appName();
  const off = "Not configured";
  const email =
    f.email === "resend" ? "Resend" : f.email === "smtp" ? "SMTP" : "Outbox only";
  return [
    {
      id: "database",
      label: "Database",
      status: f.database ? "ok" : onVercel ? "warning" : "ok",
      value: f.database ? "Postgres connected" : onVercel ? "Required: connect a Postgres database" : "Embedded database (local PGlite)",
      envVars: ["DATABASE_URL"],
      hint: f.database || onVercel ? undefined : "Fine for local use. Deployments need Postgres.",
    },
    {
      id: "session_secret",
      label: "Session secret",
      status: f.sessionSecretFromEnv ? "ok" : "off",
      value: f.sessionSecretFromEnv ? "Set" : off,
      envVars: ["SESSION_SECRET"],
      hint: f.sessionSecretFromEnv ? undefined : `Optional: ${app} generates one and stores it in the database.`,
    },
    {
      id: "encryption_key",
      label: "Encryption key",
      status: f.encryptionKeyFromEnv ? "ok" : "off",
      value: f.encryptionKeyFromEnv ? "Set" : off,
      envVars: ["ENCRYPTION_KEY"],
      hint: f.encryptionKeyFromEnv
        ? "Changing it later makes stored calendar tokens unreadable (connections then ask to reconnect)."
        : "Recommended: tokens are then protected even in database backups. Without it a key is generated and stored in the database.",
    },
    {
      id: "google",
      label: "Google (sign in, Calendar, Meet)",
      status: f.googleOAuth ? "ok" : "off",
      value: f.googleOAuth ? "Configured" : off,
      envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    },
    {
      id: "microsoft",
      label: "Microsoft (sign in)",
      status: f.microsoftOAuth ? "ok" : "off",
      value: f.microsoftOAuth ? `Configured (tenant ${e.MICROSOFT_TENANT ?? "common"})` : off,
      envVars: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT"],
    },
    {
      id: "email",
      label: "Email provider",
      status: f.email === "outbox" ? "off" : "ok",
      value: email,
      envVars: ["RESEND_API_KEY", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"],
      hint: f.email === "outbox" ? "Emails are stored in the database outbox instead of being sent. Set RESEND_API_KEY or SMTP_HOST to send them." : undefined,
    },
    {
      id: "cron_secret",
      label: "Cron secret",
      status: f.cronSecret ? "ok" : "off",
      value: f.cronSecret ? "Set" : off,
      envVars: ["CRON_SECRET"],
      hint: f.cronSecret ? undefined : "Recommended: only callers with the secret can trigger /api/cron.",
    },
  ];
}

export type BackgroundStatus = {
  lastCronAt: Date | null;
  /** The last tick is older than 15 minutes (or there was none). */
  stale: boolean;
  /** Pending jobs that are already due. */
  dueJobs: number;
};

export const CRON_STALE_MS = 15 * 60 * 1000;

/** Cron freshness and backlog, or null in setup mode or when the database is unreachable. */
export async function backgroundStatus(): Promise<BackgroundStatus | null> {
  if (setupRequired()) return null;
  try {
    const db = await getDb();
    const [row] = await db.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, "last_cron_at")).limit(1);
    const parsed = typeof row?.value === "string" ? new Date(row.value) : null;
    const lastCronAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, now())));
    return { lastCronAt, stale: !lastCronAt || now().getTime() - lastCronAt.getTime() > CRON_STALE_MS, dueJobs: Number(n) };
  } catch {
    return null;
  }
}

export const CRON_STALE_MESSAGE = "Reminders may be sent late. Set up a pinger that calls /api/cron every 5 minutes.";

/** Repository README anchor for the optional variables (the deployed repository on Vercel, else the upstream one). */
export function optionalVariablesDocsUrl(): string {
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  const repo = owner && slug ? `https://github.com/${owner}/${slug}` : "https://github.com/Julian88Tex/calendar-scheduler";
  return `${repo}#optional-environment-variables`;
}
