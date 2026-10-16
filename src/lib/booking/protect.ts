// Abuse protection of the public booking endpoints (SPEC BK-18, BK-31, GEN-08):
//
// - Bot checks on every booking submission: a hidden honeypot field, a minimum form time of 2 seconds since render
//   (an HMAC-signed render timestamp from issueBookingFormToken()), and Cloudflare Turnstile when TURNSTILE_SITE_KEY
//   and TURNSTILE_SECRET_KEY are set. Failures return one generic error and create nothing.
// - Rate limits (keys hold hashed IPs only): slots 60 per IP per minute and 600 per hour; booking attempts 10 per IP
//   per 10 minutes per event type and 30 per IP per hour overall.
import "server-only";
import { hashIp, hmacSha256Hex, timingSafeEqualStr } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
import { getSecret } from "@/lib/secrets";
import { nowMs } from "@/lib/time/now";

export const MIN_FORM_MS = 2_000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const HONEYPOT_FIELD = "website";

async function sign(ts: number): Promise<string> {
  return hmacSha256Hex(await getSecret("session_secret"), `booking-form:${ts}`).slice(0, 32);
}

/** A signed render timestamp for the booking form ("{ms}.{hmac}"); the page renders it in a hidden field. */
export async function issueBookingFormToken(at: number = nowMs()): Promise<string> {
  const ts = Math.floor(at);
  return `${ts}.${await sign(ts)}`;
}

export type BotCheckInput = {
  honeypot?: string | null;
  formToken?: string | null;
  turnstileToken?: string | null;
  ip?: string | null;
  now?: number;
};

export type BotCheckResult = { ok: true } | { ok: false; reason: "honeypot" | "token" | "too_fast" | "turnstile" };

/** BK-18 checks (see the file header). */
export async function checkBookingBot(input: BotCheckInput): Promise<BotCheckResult> {
  if (input.honeypot && input.honeypot.trim() !== "") return { ok: false, reason: "honeypot" };
  const at = input.now ?? nowMs();
  const m = /^(\d{10,16})\.([0-9a-f]{32})$/.exec(input.formToken?.trim() ?? "");
  if (!m) return { ok: false, reason: "token" };
  const ts = Number(m[1]);
  if (!timingSafeEqualStr(await sign(ts), m[2]!)) return { ok: false, reason: "token" };
  const age = at - ts;
  if (age < MIN_FORM_MS) return { ok: false, reason: "too_fast" };
  if (age > MAX_FORM_AGE_MS) return { ok: false, reason: "token" };
  const env = getEnv();
  if (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) {
    if (!input.turnstileToken) return { ok: false, reason: "turnstile" };
    if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, input.turnstileToken, input.ip ?? null))) {
      return { ok: false, reason: "turnstile" };
    }
  }
  return { ok: true };
}

/** Cloudflare Turnstile siteverify (fixed URL, 5 second timeout; network failures fail closed). */
async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token.slice(0, 2048) });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetch(TURNSTILE_URL, { method: "POST", body, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    log.warn("booking.turnstile_failed", { error: e });
    return false;
  }
}

/** GET /api/public/slots limits (BK-31): 60 per IP per minute and 600 per hour; throws AppError("rate_limited"). */
export async function assertSlotsRateLimit(ip: string | null): Promise<void> {
  const key = await hashIp(ip);
  const minute = await rateLimit(`slots:ip:${key}`, 60, 60);
  if (!minute.ok) throw rateLimitedError(minute, "Too many requests. Try again in a minute.");
  const hour = await rateLimit(`slots:ip:${key}:h`, 600, 3600);
  if (!hour.ok) throw rateLimitedError(hour, "Too many requests. Try again later.");
}

/** Booking attempts (BK-18): 10 per IP per 10 minutes per event type and 30 per IP per hour overall. */
export async function assertBookingRateLimit(ip: string | null, eventTypeKey: string): Promise<void> {
  const key = await hashIp(ip);
  const perType = await rateLimit(`booking:ip:${key}:${eventTypeKey.replace(/:/g, "_").slice(0, 64)}`, 10, 600);
  if (!perType.ok) throw rateLimitedError(perType);
  const overall = await rateLimit(`booking:ip:${key}`, 30, 3600);
  if (!overall.ok) throw rateLimitedError(overall);
}

/** Code verification attempts per IP (abuse guard on top of the 5 attempts per code): 30 per 10 minutes. */
export async function assertVerifyRateLimit(ip: string | null): Promise<void> {
  const key = await hashIp(ip);
  const r = await rateLimit(`booking:verify:ip:${key}`, 30, 600);
  if (!r.ok) throw rateLimitedError(r);
}
