// Configuration of the owner bootstrap (docs/DEPLOY.md):
// - SETUP_TOKEN (and CRON_SECRET, which the deployment already has): the bearer secrets that authorize
//   POST /api/setup/bootstrap, each only when at least SETUP_TOKEN_MIN_LENGTH characters long. With neither usable
//   the endpoint is disabled.
// - OWNER_EMAIL: when set, the only email the bootstrap accepts (route and script alike), and the only one the
//   first-account exception of the signup policy applies to (src/lib/auth/policy.ts).
// Both are parsed by src/lib/env.ts (empty values count as unset). env.ts reads a malformed value as unset, so the raw
// value is checked here too: a set but malformed OWNER_EMAIL disables the bootstrap instead of accepting any email.
import { timingSafeEqualStr } from "@/lib/crypto";
import { getEnv, parseEnv, SETUP_TOKEN_MIN_LENGTH, type Env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { normalizeEmail } from "@/lib/validation";

/**
 * Shortest bearer secret the bootstrap accepts, for SETUP_TOKEN and CRON_SECRET alike: either one authorizes claiming a
 * fresh instance, so a secret anyone could guess must not. Defined in src/lib/env.ts (the SETUP_TOKEN schema).
 */
export { SETUP_TOKEN_MIN_LENGTH };

export const BOOTSTRAP_DISABLED_MESSAGE = `The owner bootstrap is disabled. Set SETUP_TOKEN (or CRON_SECRET), at least ${SETUP_TOKEN_MIN_LENGTH} characters, on the server first.`;
export const OWNER_EMAIL_INVALID_MESSAGE = "OWNER_EMAIL is not a valid email address. Fix it on the server first.";
export const OWNER_EMAIL_MISMATCH_MESSAGE = "This email is not the owner email configured on the server (OWNER_EMAIL).";

type EnvSource = Record<string, string | undefined>;

/** Whether the raw variable is set (not empty after trimming), valid or not. */
function isSet(name: string, source: EnvSource): boolean {
  const raw = source[name];
  return typeof raw === "string" && raw.trim() !== "";
}

/** The parsed environment of `source` (the cached one for process.env). */
function envOf(source: EnvSource): Env {
  return source === process.env ? getEnv() : parseEnv(source);
}

const warnedShort = new Set<string>();

/**
 * The bearer secrets that authorize the bootstrap: SETUP_TOKEN and CRON_SECRET, each ignored (with one warning) when
 * shorter than SETUP_TOKEN_MIN_LENGTH. A short CRON_SECRET still protects /api/cron; it just cannot claim the instance.
 */
export function bootstrapSecrets(source: EnvSource = process.env): string[] {
  const e = envOf(source);
  const out: string[] = [];
  for (const name of ["SETUP_TOKEN", "CRON_SECRET"] as const) {
    if (!isSet(name, source)) continue;
    // env.ts reads a SETUP_TOKEN shorter than the minimum as unset; CRON_SECRET has no minimum there.
    const value = e[name];
    if (value && value.length >= SETUP_TOKEN_MIN_LENGTH) {
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
export function configuredOwnerEmail(source: EnvSource = process.env): string | null {
  if (!isSet("OWNER_EMAIL", source)) return null;
  const owner = envOf(source).OWNER_EMAIL;
  if (!owner) throw new AppError("not_configured", OWNER_EMAIL_INVALID_MESSAGE);
  return normalizeEmail(owner);
}

/** Refuses an email other than OWNER_EMAIL (when set) with AppError("forbidden"). */
export function assertOwnerEmailAllowed(email: string, source: EnvSource = process.env): void {
  const owner = configuredOwnerEmail(source);
  if (owner && normalizeEmail(email) !== owner) {
    throw new AppError("forbidden", OWNER_EMAIL_MISMATCH_MESSAGE, { fieldErrors: { email: [OWNER_EMAIL_MISMATCH_MESSAGE] } });
  }
}
