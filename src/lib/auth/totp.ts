// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// TOTP (SPEC AU-09, RFC 6238): SHA-1, 6 digits, 30 second steps, one step of drift accepted. Foundation stub: a
// complete, dependency-free verify and secret generator (enrollment UI is settings-onboarding).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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

/** True when `code` matches the current step or one step of drift either way. */
export function verifyTotp(secretBase32: string, code: string, opts: { atMs?: number; window?: number } = {}): boolean {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return false;
  const counter = Math.floor((opts.atMs ?? Date.now()) / 30_000);
  const window = opts.window ?? 1;
  for (let d = -window; d <= window; d++) {
    const expected = Buffer.from(totpCode(secretBase32, counter + d));
    if (timingSafeEqual(expected, Buffer.from(digits))) return true;
  }
  return false;
}

/** otpauth:// URI for authenticator apps (QR code). */
export function totpUri(p: { secretBase32: string; accountName: string; issuer: string }): string {
  const label = encodeURIComponent(`${p.issuer}:${p.accountName}`);
  const q = new URLSearchParams({ secret: p.secretBase32, issuer: p.issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${q.toString()}`;
}
