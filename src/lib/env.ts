// Environment variables (ARCHITECTURE section 22): every variable is optional.
//
// `env` is parsed with zod from process.env on access (cached until process.env changes, so tests and scripts that set
// variables see them). Empty strings count as unset. Invalid values log one warning and are treated as unset; nothing
// here ever throws for configuration. `features` derives what is configured.
//
// Server only by convention (client bundles only see NEXT_PUBLIC_* values). Never import this from src/proxy.ts or
// next.config.ts; it has no dependencies besides zod so scripts and tests can import it.
import { z } from "zod";

const str = z.string().trim().min(1);
const url = z.url({ protocol: /^https?$/ }).transform((v) => v.replace(/\/+$/, ""));
const intIn = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const bool = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => ["1", "0", "true", "false", "yes", "no", "on", "off"].includes(v), "expected a boolean")
  .transform((v) => ["1", "true", "yes", "on"].includes(v));
const list = z
  .string()
  .transform((v) =>
    v
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
const emailList = list.transform((items) => items.map((s) => s.toLowerCase()));

const SCHEMA = {
  DATABASE_URL: str,
  POSTGRES_URL: str,
  DATABASE_URL_UNPOOLED: str,
  POSTGRES_URL_NON_POOLING: str,
  MIGRATE_ON_PREVIEW: bool,
  PGLITE_DIR: str,
  APP_URL: url,
  NEXT_PUBLIC_APP_NAME: str,
  SESSION_SECRET: str,
  ENCRYPTION_KEY: str,
  CRON_SECRET: str,
  ADMIN_EMAILS: emailList,
  SIGNUP_POLICY: z.enum(["invite_only", "open", "domains"]),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]),
  GOOGLE_CLIENT_ID: str,
  GOOGLE_CLIENT_SECRET: str,
  MICROSOFT_CLIENT_ID: str,
  MICROSOFT_CLIENT_SECRET: str,
  MICROSOFT_TENANT: str,
  ZOOM_CLIENT_ID: str,
  ZOOM_CLIENT_SECRET: str,
  JITSI_BASE_URL: url,
  RESEND_API_KEY: str,
  SMTP_HOST: str,
  SMTP_PORT: intIn(1, 65535),
  SMTP_USER: str,
  SMTP_PASS: str,
  SMTP_SECURE: bool,
  EMAIL_FROM: str,
  TWILIO_ACCOUNT_SID: str,
  TWILIO_AUTH_TOKEN: str,
  TWILIO_FROM_NUMBER: str,
  TWILIO_MESSAGING_SERVICE_SID: str,
  STRIPE_SECRET_KEY: str,
  STRIPE_WEBHOOK_SECRET: str,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: str,
  PAYPAL_CLIENT_ID: str,
  PAYPAL_CLIENT_SECRET: str,
  PAYPAL_ENV: z.enum(["sandbox", "live"]),
  TURNSTILE_SITE_KEY: str,
  TURNSTILE_SECRET_KEY: str,
  BLOB_READ_WRITE_TOKEN: str,
  CALENDAR_CACHE_TTL_SECONDS: intIn(0, 86_400),
  JOBS_POLL_INTERVAL_SECONDS: intIn(5, 3_600),
  SAFE_FETCH_ALLOW_HOSTS: list.transform((items) => items.map((s) => s.toLowerCase())),
  NEXT_DIST_DIR: str,
  E2E_TEST_MODE: bool,
  E2E_SECRET: str,
  TEST_DATABASE_URL: str,
  // Platform variables (Vercel system env, Node).
  VERCEL: str,
  VERCEL_ENV: z.enum(["production", "preview", "development"]),
  VERCEL_URL: str,
  VERCEL_BRANCH_URL: str,
  VERCEL_PROJECT_PRODUCTION_URL: str,
  NODE_ENV: str,
  PORT: intIn(1, 65535),
} as const;

type Schema = typeof SCHEMA;
export type EnvKey = keyof Schema;
/** Parsed environment: every key optional. */
export type Env = { [K in EnvKey]?: z.output<Schema[K]> };

export const ENV_KEYS = Object.keys(SCHEMA) as EnvKey[];

let cache: { fingerprint: string; value: Env } | null = null;
const warned = new Set<string>();

function fingerprint(source: Record<string, string | undefined>): string {
  let out = "";
  for (const k of ENV_KEYS) out += `${k}=${source[k] ?? ""}\u0000`;
  return out;
}

/** Parses an environment object (process.env by default). Never throws. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const out: Record<string, unknown> = {};
  for (const key of ENV_KEYS) {
    const raw = source[key];
    if (raw === undefined || raw.trim() === "") continue;
    const res = (SCHEMA[key] as z.ZodType).safeParse(raw);
    if (res.success) {
      out[key] = res.data;
    } else {
      const sig = `${key}=${raw}`;
      if (!warned.has(sig)) {
        warned.add(sig);
        // console directly: the logger reads env, so env must not depend on the logger.
        console.warn(
          JSON.stringify({ level: "warn", event: "env.invalid", key, message: res.error.issues[0]?.message ?? "invalid" }),
        );
      }
    }
  }
  return out as Env;
}

/** The current parsed environment. */
export function getEnv(): Env {
  const fp = fingerprint(process.env);
  if (!cache || cache.fingerprint !== fp) cache = { fingerprint: fp, value: parseEnv(process.env) };
  return cache.value;
}

/** Live view of the parsed environment: `env.APP_URL`, `env.ADMIN_EMAILS`, ... (re-parsed when process.env changes). */
export const env: Readonly<Env> = new Proxy({} as Env, {
  get: (_t, key: string) => (getEnv() as Record<string, unknown>)[key],
  has: (_t, key: string) => key in getEnv(),
  ownKeys: () => Reflect.ownKeys(getEnv()),
  getOwnPropertyDescriptor: (_t, key: string) => {
    const value = (getEnv() as Record<string, unknown>)[key];
    return value === undefined ? undefined : { value, enumerable: true, configurable: true, writable: false };
  },
});

/** True on any Vercel deployment (production, preview or development). */
export function isVercel(): boolean {
  return Boolean(getEnv().VERCEL);
}

/** True for production builds (NODE_ENV=production). Vercel previews are production builds too. */
export function isProd(): boolean {
  return getEnv().NODE_ENV === "production";
}

/** True under Vitest. */
export function isTest(): boolean {
  return getEnv().NODE_ENV === "test";
}

export type EmailTransport = "resend" | "smtp" | "outbox";

export type Features = {
  database: boolean;
  googleOAuth: boolean;
  microsoftOAuth: boolean;
  zoom: boolean;
  /** Which email transport sends: Resend, SMTP, or the database outbox (GEN-15). */
  email: EmailTransport;
  sms: boolean;
  stripe: boolean;
  /** Inline Payment Element (publishable key present); otherwise Stripe Checkout redirect. */
  stripeInline: boolean;
  paypal: boolean;
  turnstile: boolean;
  blob: boolean;
  cronSecret: boolean;
  sessionSecretFromEnv: boolean;
  encryptionKeyFromEnv: boolean;
};

/** What is configured, derived from the environment (GEN-09 status checklist, integration tiles). */
export function getFeatures(e: Env = getEnv()): Features {
  return {
    database: Boolean(e.DATABASE_URL || e.POSTGRES_URL),
    googleOAuth: Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
    microsoftOAuth: Boolean(e.MICROSOFT_CLIENT_ID && e.MICROSOFT_CLIENT_SECRET),
    zoom: Boolean(e.ZOOM_CLIENT_ID && e.ZOOM_CLIENT_SECRET),
    email: e.RESEND_API_KEY ? "resend" : e.SMTP_HOST ? "smtp" : "outbox",
    sms: Boolean(e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && (e.TWILIO_FROM_NUMBER || e.TWILIO_MESSAGING_SERVICE_SID)),
    stripe: Boolean(e.STRIPE_SECRET_KEY),
    stripeInline: Boolean(e.STRIPE_SECRET_KEY && e.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
    paypal: Boolean(e.PAYPAL_CLIENT_ID && e.PAYPAL_CLIENT_SECRET),
    turnstile: Boolean(e.TURNSTILE_SITE_KEY && e.TURNSTILE_SECRET_KEY),
    blob: Boolean(e.BLOB_READ_WRITE_TOKEN),
    cronSecret: Boolean(e.CRON_SECRET),
    sessionSecretFromEnv: Boolean(e.SESSION_SECRET),
    encryptionKeyFromEnv: Boolean(e.ENCRYPTION_KEY),
  };
}

/** Live view of getFeatures(): `features.googleOAuth`, `features.email`, ... */
export const features: Readonly<Features> = new Proxy({} as Features, {
  get: (_t, key: string) => (getFeatures() as Record<string, unknown>)[key],
  has: (_t, key: string) => key in getFeatures(),
  ownKeys: () => Reflect.ownKeys(getFeatures()),
  getOwnPropertyDescriptor: (_t, key: string) => ({
    value: (getFeatures() as Record<string, unknown>)[key],
    enumerable: true,
    configurable: true,
    writable: false,
  }),
});

/** Instance admins from ADMIN_EMAILS (lowercase), in addition to users.is_instance_admin (the first user). */
export function adminEmails(): string[] {
  return getEnv().ADMIN_EMAILS ?? [];
}

/** Microsoft tenant (default "common"). */
export function microsoftTenant(): string {
  return getEnv().MICROSOFT_TENANT ?? "common";
}

/** Jitsi server origin (default https://meet.jit.si). */
export function jitsiBaseUrl(): string {
  return getEnv().JITSI_BASE_URL ?? "https://meet.jit.si";
}

/** Booking page busy cache TTL (default 180 seconds). */
export function calendarCacheTtlSeconds(): number {
  return getEnv().CALENDAR_CACHE_TTL_SECONDS ?? 180;
}

/** Self-hosted job poller interval (default 30 seconds). */
export function jobsPollIntervalSeconds(): number {
  return getEnv().JOBS_POLL_INTERVAL_SECONDS ?? 30;
}

/** True when the E2E test API and fake clock may be used (never on Vercel). */
export function isE2eMode(): boolean {
  const e = getEnv();
  return e.E2E_TEST_MODE === true && !e.VERCEL;
}
