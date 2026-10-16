// Booking page copy (ARCHITECTURE section 19): a tiny translator over the English "booking" catalog. Client and server
// safe. The booking components import the catalog file directly (not @/lib/i18n, which bundles every namespace and the
// zone names) to keep the public page bundle small (GEN-07). Invitee pages are English only (docs/SCOPE.md).
import messages from "@/lib/i18n/messages/en/booking";

export type BookingMessages = typeof messages;
export type Vars = Record<string, string | number>;

function lookup(key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Replaces {name} placeholders; unknown placeholders stay as written. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m));
}

/** The booking string for a dotted key ("details.title"), or the key itself when missing. */
export function bt(key: string, vars?: Vars): string {
  return interpolate(lookup(key) ?? key, vars);
}

export { messages as bookingMessages };
