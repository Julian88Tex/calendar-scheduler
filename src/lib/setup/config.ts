// Configuration of the owner bootstrap (docs/DEPLOY.md):
// - SETUP_TOKEN (and CRON_SECRET, which the deployment already has): the bearer secrets that authorize
//   POST /api/setup/bootstrap, each only when at least SETUP_TOKEN_MIN_LENGTH characters long. With neither usable
//   the endpoint is disabled.
// - OWNER_EMAIL: when set, the only email the bootstrap accepts (route and script alike).
// SETUP_TOKEN and OWNER_EMAIL are read here rather than in src/lib/env.ts (owned by foundation); like env.ts, empty
// values count as unset. A set but malformed OWNER_EMAIL disables the bootstrap instead of accepting any email.
import { timingSafeEqualStr } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { normalizeEmail, zEmail } from "@/lib/validation";

/**
 * Shortest bearer secret the bootstrap accepts, for SETUP_TOKEN and CRON_SECRET alike: either one authorizes claiming a
 * fresh instance, so a secret anyone could guess must not.
 */
export const SETUP_TOKEN_MIN_LENGTH = 24;

export const BOOTSTRAP_DISABLED_MESSAGE = `The owner bootstrap is disabled. Set SETUP_TOKEN (or CRON_SECRET), at least ${SETUP_TOKEN_MIN_LENGTH} characters, on the server first.`;
export const OWNER_EMAIL_INVALID_MESSAGE = "OWNER_EMAIL is not a valid email address. Fix it on the server first.";
export const OWNER_EMAIL_MISMATCH_MESSAGE = "This email is not the owner email configured on the server (OWNER_EMAIL).";

function envValue(name: string, source: Record<string, string | undefined>): string | null {
  const raw = source[name];
  const v = typeof raw === "string" ? raw.trim() : "";
  return v ? v : null;
}

const warnedShort = new Set<string>();

/**
 * The bearer secrets that authorize the bootstrap: SETUP_TOKEN and CRON_SECRET, each ignored (with one warning) when
 * shorter than SETUP_TOKEN_MIN_LENGTH. A short CRON_SECRET still protects /api/cron; it just cannot claim the instance.
 */
export function bootstrapSecrets(source: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  for (const name of ["SETUP_TOKEN", "CRON_SECRET"] as const) {
    const value = envValue(name, source);
    if (!value) continue;
    if (value.length >= SETUP_TOKEN_MIN_LENGTH) {
      out.push(value);
    } else if (!warnedShort.has(name)) {
      warnedShort.add(name);
      log.warn("setup.secret_too_short", { message: `${name} is ignored by the owner bootstrap: use at least ${SETUP_TOKEN_MIN_LENGTH} characters.` });
    }
  }
  return out;
}

/**
 * True when `authorization` is exactly "Bearer {secret}" for one of the secrets. Every secret is compared (constant
 * time per comparison, SHA-256 of both sides), so the answer does not leak which secret matched or how much of it.
 */
export function bearerMatches(authorization: string | null | undefined, secrets: readonly string[]): boolean {
  const header = (authorization ?? "").trim();
  let ok = false;
  for (const secret of secrets) {
    if (timingSafeEqualStr(header, `Bearer ${secret}`)) ok = true;
  }
  return ok;
}

/** The normalized OWNER_EMAIL, or null when unset. Throws AppError("not_configured") when it is malformed. */
export function configuredOwnerEmail(source: Record<string, string | undefined> = process.env): string | null {
  const raw = envValue("OWNER_EMAIL", source);
  if (!raw) return null;
  const parsed = zEmail.safeParse(raw);
  if (!parsed.success) throw new AppError("not_configured", OWNER_EMAIL_INVALID_MESSAGE);
  return normalizeEmail(parsed.data);
}

/** Refuses an email other than OWNER_EMAIL (when set) with AppError("forbidden"). */
export function assertOwnerEmailAllowed(email: string, source: Record<string, string | undefined> = process.env): void {
  const owner = configuredOwnerEmail(source);
  if (owner && normalizeEmail(email) !== owner) {
    throw new AppError("forbidden", OWNER_EMAIL_MISMATCH_MESSAGE, { fieldErrors: { email: [OWNER_EMAIL_MISMATCH_MESSAGE] } });
  }
}
