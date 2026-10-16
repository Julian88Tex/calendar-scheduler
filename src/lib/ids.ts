// Identifiers and short codes (ARCHITECTURE section 21). Client and server safe (Web Crypto only).
//
// - newId(): a v4 UUID (primary keys created in code, LocationConfig ids, invitee capability ids).
// - shortCode(): "xxxx-xxxx" for /d/{code} links, from an alphabet without ambiguous characters (no 0/o, 1/l/i).
// - pollSlug(): 10 characters for /p/{slug}. routingSlug(): "xxx-xxx-xxx" for /r/{slug}.
// - jitsiRoom(): "{app-name-slug}-{20 random characters}" (section 11).
// Uniqueness is enforced by unique indexes; callers retry on a unique violation (collisions are astronomically rare).
import { appNameSlug } from "./brand";

/** Lowercase letters and digits without 0, o, 1, l and i. */
export const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
/** Lowercase letters and digits. */
export const ALNUM_LOWER = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A random v4 UUID. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** `length` characters drawn uniformly from `alphabet` (rejection sampling, no modulo bias). */
export function randomString(length: number, alphabet: string = CODE_ALPHABET): string {
  if (!Number.isInteger(length) || length < 0) throw new Error("randomString: invalid length");
  if (alphabet.length < 2 || alphabet.length > 256) throw new Error("randomString: invalid alphabet");
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  const buf = new Uint8Array(Math.max(16, length * 2));
  while (out.length < length) {
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit) out += alphabet[b % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** "xxxx-xxxx" single-use link, one-off and shared event type code. */
export function shortCode(): string {
  return `${randomString(4)}-${randomString(4)}`;
}

/** 10 character poll slug. */
export function pollSlug(): string {
  return randomString(10);
}

/** "xxx-xxx-xxx" routing form slug. */
export function routingSlug(): string {
  return `${randomString(3)}-${randomString(3)}-${randomString(3)}`;
}

/** Jitsi room name "{app-name-slug}-{20 random characters}". */
export function jitsiRoom(): string {
  return `${appNameSlug}-${randomString(20, ALNUM_LOWER)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string (validate route params before querying uuid columns). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
