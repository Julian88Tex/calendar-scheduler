// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email address and header helpers (ARCHITECTURE section 13.1, SPEC NT-20). Pure: no I/O.

export type ParsedAddress = { name: string | null; address: string };

// Pragmatic address check (RFC 5322 is far wider; providers reject the rest anyway).
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** True for a bare address such as "jane@example.com" ("localhost" style domains are allowed for local installs). */
export function isValidEmailAddress(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.length > 254 || v.includes("..")) return false;
  const at = v.lastIndexOf("@");
  if (at < 1 || at > 64) return false;
  return ADDRESS.test(v);
}

/** Removes CR, LF and other control characters (header injection) and trims. */
export function sanitizeHeaderValue(value: string, maxLength = 998): string {
  return value
    .replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Parses `"Name" <a@b>`, `Name <a@b>` or `a@b`. Returns null when no valid address is found. */
export function parseAddress(value: string | null | undefined): ParsedAddress | null {
  if (!value) return null;
  const v = sanitizeHeaderValue(value);
  const angle = /^(.*)<\s*([^<>\s]+)\s*>\s*$/.exec(v);
  if (angle) {
    const address = angle[2]!.trim();
    if (!isValidEmailAddress(address)) return null;
    let name = angle[1]!.trim();
    if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
      name = name.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    return { name: name || null, address };
  }
  return isValidEmailAddress(v) ? { name: null, address: v } : null;
}

/** Formats a mailbox for a From or Reply-To header: `"Jane Doe via Kairos" <notifications@example.com>`. */
export function formatAddress(name: string | null | undefined, address: string): string {
  const cleanName = name ? sanitizeHeaderValue(name, 200) : "";
  if (!cleanName) return address;
  return `"${cleanName.replace(/(["\\])/g, "\\$1")}" <${address}>`;
}

/**
 * Normalizes a recipient list: trims, accepts "Name <a@b>" forms (kept as written), drops invalid entries and
 * duplicates (case-insensitive on the address), keeping the first spelling.
 */
export function normalizeRecipients(list: readonly (string | null | undefined)[] | null | undefined): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    if (raw === null || raw === undefined) continue;
    const value = sanitizeHeaderValue(String(raw), 320);
    if (!value) continue;
    const parsed = parseAddress(value);
    if (!parsed) {
      invalid.push(value);
      continue;
    }
    const key = parsed.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(parsed.name ? formatAddress(parsed.name, parsed.address) : parsed.address);
  }
  return { valid, invalid };
}

/** The bare address of a recipient entry ("Jane <j@x.com>" -> "j@x.com"). */
export function addressOf(value: string): string {
  return parseAddress(value)?.address ?? value.trim();
}
