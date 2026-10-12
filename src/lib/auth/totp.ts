// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// TOTP (SPEC AU-09, RFC 6238): SHA-1, 6 digits, 30 second steps, one step of drift accepted, plus one-time recovery
// codes. Pure and dependency free (node:crypto only); the database side (encrypted secrets, hashed recovery codes,
// replay protection, the /login/two-factor challenge) lives in src/lib/auth/flows/two-factor.ts. The enrollment UI
// belongs to settings-onboarding.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits) in base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 6-digit code for a 30-second step counter. */
export function totpCode(secretBase32: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(bin % 1_000_000).padStart(6, "0");
}

/** RFC 6238 step length in seconds. */
export const TOTP_PERIOD_SECONDS = 30;

/** The 30-second step counter of an instant. */
export function totpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / (TOTP_PERIOD_SECONDS * 1000));
}

/** Digits of a submitted code ("123 456" and "123-456" accepted), or null when it is not 6 digits. */
export function normalizeTotpCode(code: string): string | null {
  const digits = String(code ?? "").replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * The step counter that `code` matches (current step or `window` steps of drift either way), or null. Callers that
 * persist the last accepted step use it to reject a replayed code (RFC 6238 section 5.2).
 */
export function matchTotpStep(
  secretBase32: string,
  code: string,
  opts: { atMs?: number; window?: number } = {},
): number | null {
  const digits = normalizeTotpCode(code);
  if (!digits) return null;
  let secretOk = true;
  try {
    base32Decode(secretBase32);
  } catch {
    secretOk = false;
  }
  if (!secretOk) return null;
  const counter = totpStep(opts.atMs ?? Date.now());
  const window = opts.window ?? 1;
  let matched: number | null = null;
  // Check every step (no early exit) so timing does not reveal which step matched.
  for (let d = -window; d <= window; d++) {
    const expected = Buffer.from(totpCode(secretBase32, counter + d));
    if (timingSafeEqual(expected, Buffer.from(digits)) && matched === null) matched = counter + d;
  }
  return matched;
}

/** True when `code` matches the current step or one step of drift either way. */
export function verifyTotp(secretBase32: string, code: string, opts: { atMs?: number; window?: number } = {}): boolean {
  return matchTotpStep(secretBase32, code, opts) !== null;
}

// ---------------------------------------------------------------------------------------------------------------
// Recovery codes (AU-09): 10 one-time codes shown once after enrollment ("Download" and "Copy").

/** Number of recovery codes generated per enrollment. */
export const RECOVERY_CODE_COUNT = 10;

/** Lowercase letters and digits without look-alikes (no 0/o, 1/l/i). */
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** `count` random codes formatted "xxxxx-xxxxx" (10 characters, about 49 bits each). */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const out = new Set<string>();
  while (out.size < count) {
    let code = "";
    for (let i = 0; i < 10; i++) code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    out.add(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return [...out];
}

/** Canonical form for hashing and comparison: lowercase, without spaces and hyphens. */
export function normalizeRecoveryCode(code: string): string {
  return String(code ?? "")
    .toLowerCase()
    .replace(/[\s-]/g, "");
}

/** True when the input has the shape of a recovery code (10 characters of the alphabet). */
export function looksLikeRecoveryCode(code: string): boolean {
  return /^[a-z0-9]{10}$/.test(normalizeRecoveryCode(code));
}

/** otpauth:// URI for authenticator apps (QR code). */
export function totpUri(p: { secretBase32: string; accountName: string; issuer: string }): string {
  const label = encodeURIComponent(`${p.issuer}:${p.accountName}`);
  const q = new URLSearchParams({ secret: p.secretBase32, issuer: p.issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${q.toString()}`;
}
