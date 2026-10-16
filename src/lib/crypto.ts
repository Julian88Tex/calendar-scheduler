// Crypto helpers (ARCHITECTURE section 18.2, SPEC GEN-08, tech-reference 14).
//
// - encrypt()/decrypt(): AES-256-GCM, format "v1.{iv}.{ct}.{tag}" (base64url), key from getSecret("encryption_key").
//   Columns holding the output end in _enc.
// - hashToken(): SHA-256 hex of a random token (columns ending in _hash). randomToken(): 32 random bytes base64url.
// - hashPassword()/verifyPassword(): scrypt N=16384, r=8, p=1, 64-byte key, NFKC normalized.
// - hashCode(): HMAC-SHA256 with the session secret over purpose:contextId:code for 6-digit verification codes (a plain
//   SHA-256 of a 6-digit code is brute-forced offline in milliseconds).
// - hashIp(): HMAC-SHA256 of an IP with the session secret (abuse checks and rate limit keys without raw IPs).
import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { getSecret } from "./secrets";

// ---------------------------------------------------------------------------------------------------------------
// Encryption at rest

const ENC_VERSION = "v1";

/** Encrypts with an explicit 32-byte key (sync; tests and key rotation). */
export function encryptWithKey(plain: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${ENC_VERSION}.${iv.toString("base64url")}.${ct.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

/** Decrypts with an explicit key. Throws on a wrong key, tampering or a malformed blob. */
export function decryptWithKey(blob: string, key: Buffer): string {
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== ENC_VERSION) throw new Error("not an encrypted value");
  const [, iv, ct, tag] = parts as [string, string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** True when the value looks like encrypt() output. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$/.test(value);
}

/** AES-256-GCM with the instance encryption key. */
export async function encrypt(plain: string): Promise<string> {
  return encryptWithKey(plain, await getSecret("encryption_key"));
}

/** Inverse of encrypt(). Throws when the key changed or the value was tampered with. */
export async function decrypt(blob: string): Promise<string> {
  return decryptWithKey(blob, await getSecret("encryption_key"));
}

/** decrypt() that returns null instead of throwing (connections then show "Action required", never crash). */
export async function decryptOrNull(blob: string | null | undefined): Promise<string | null> {
  if (!blob) return null;
  try {
    return await decrypt(blob);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tokens, hashes, comparisons

/** SHA-256 hex digest. */
export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** SHA-256 hex of a token (what _hash columns store). */
export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** A random token for URLs and cookies: `bytes` random bytes (default 32, 256 bits) as base64url. */
export function randomToken(bytes = 32): string {
  if (bytes < 16) throw new Error("tokens need at least 128 bits (GEN-08)");
  return randomBytes(bytes).toString("base64url");
}

/** A random code of `length` characters from `alphabet` (default: 6 digits). Uniform (crypto.randomInt). */
export function randomCode(length = 6, alphabet = "0123456789"): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** HMAC-SHA256 hex. */
export function hmacSha256Hex(key: Buffer | string, data: string | Buffer): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

/** Constant-time string comparison (both sides hashed first, so lengths do not leak). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/** HMAC of a verification code bound to its purpose and context (reservation, poll or user id). */
export async function hashCode(purpose: string, contextId: string | null, code: string): Promise<string> {
  const secret = await getSecret("session_secret");
  return hmacSha256Hex(secret, `${purpose}:${contextId ?? ""}:${code.trim()}`);
}

/** Checks a submitted verification code against a stored hashCode() value in constant time. */
export async function verifyCode(
  purpose: string,
  contextId: string | null,
  code: string,
  storedHash: string,
): Promise<boolean> {
  return timingSafeEqualStr(await hashCode(purpose, contextId, code), storedHash);
}

/** HMAC of a client IP with the session secret ("" for unknown). */
export async function hashIp(ip: string | null | undefined): Promise<string> {
  const secret = await getSecret("session_secret");
  return hmacSha256Hex(secret, `ip:${(ip ?? "").trim().toLowerCase()}`).slice(0, 32);
}

// ---------------------------------------------------------------------------------------------------------------
// Passwords

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64, maxmem: 64 * 1024 * 1024 };

function scryptAsync(password: string, salt: Buffer, keyLen: number, opts: { N: number; r: number; p: number; maxmem: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** "scrypt$N$r$p$salt$hash" (base64url parts). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scryptAsync(password.normalize("NFKC"), salt, SCRYPT.keyLen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${dk.toString("base64url")}`;
}

/** Verifies a password against hashPassword() output. False for malformed or missing hashes. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, s, h] = parts as [string, string, string, string, string, string];
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every((v) => Number.isInteger(v) && v > 0) || N > 1 << 20) return false;
  const expected = Buffer.from(h, "base64url");
  if (expected.length < 16) return false;
  try {
    const dk = await scryptAsync(password.normalize("NFKC"), Buffer.from(s, "base64url"), expected.length, {
      N,
      r: R,
      p: P,
      maxmem: SCRYPT.maxmem,
    });
    return timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

/** A precomputed hash for timing-equalized checks when no account exists (login without enumeration, AU-04). */
let dummyHash: Promise<string> | null = null;
export async function verifyPasswordDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("kairos-dummy-password-for-timing");
  await verifyPassword(password, await dummyHash);
  return false;
}
