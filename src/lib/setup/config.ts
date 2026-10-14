// Configuration of the owner bootstrap (docs/DEPLOY.md):
// - SETUP_TOKEN (and CRON_SECRET, which the deployment already has): the bearer secrets that authorize
//   POST /api/setup/bootstrap. With neither set the endpoint is disabled.
// - OWNER_EMAIL: when set, the only email the bootstrap accepts (route and script alike).
// SETUP_TOKEN and OWNER_EMAIL are read here rather than in src/lib/env.ts (owned by foundation); like env.ts, empty
// values count as unset. A set but malformed OWNER_EMAIL disables the bootstrap instead of accepting any email.
import { timingSafeEqualStr } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { normalizeEmail, zEmail } from "@/lib/validation";

/** Shortest SETUP_TOKEN accepted (a token anyone could guess would let them claim the instance). */
export const SETUP_TOKEN_MIN_LENGTH = 24;

export const BOOTSTRAP_DISABLED_MESSAGE = "The owner bootstrap is disabled. Set SETUP_TOKEN (or CRON_SECRET) on the server first.";
export const OWNER_EMAIL_INVALID_MESSAGE = "OWNER_EMAIL is not a valid email address. Fix it on the server first.";
export const OWNER_EMAIL_MISMATCH_MESSAGE = "This email is not the owner email configured on the server (OWNER_EMAIL).";

function envValue(name: string, source: Record<string, string | undefined>): string | null {
  const raw = source[name];
  const v = typeof raw === "string" ? raw.trim() : "";
  return v ? v : null;
}

let warnedShortToken = false;

/**
 * The bearer secrets that authorize the bootstrap: SETUP_TOKEN (ignored, with a warning, when shorter than
 * SETUP_TOKEN_MIN_LENGTH) and CRON_SECRET.
 */
export function bootstrapSecrets(source: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  const setupToken = envValue("SETUP_TOKEN", source);
  if (setupToken && setupToken.length >= SETUP_TOKEN_MIN_LENGTH) out.push(setupToken);
  else if (setupToken && !warnedShortToken) {
    warnedShortToken = true;
    log.warn("setup.token_too_short", { message: `SETUP_TOKEN is ignored: use at least ${SETUP_TOKEN_MIN_LENGTH} characters.` });
  }
  const cron = envValue("CRON_SECRET", source);
  if (cron) out.push(cron);
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
