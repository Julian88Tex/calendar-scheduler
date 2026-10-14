// Meeting poll copy (ARCHITECTURE section 19): a tiny translator over the English "polls" catalog
// (src/lib/i18n/messages/en/polls.ts). Client and server safe. The poll components import the catalog file directly
// (not @/lib/i18n, which bundles every namespace and the zone names) to keep the public voter page lean (GEN-07); the
// pages are English only (docs/SCOPE.md skips localization).
import messages from "@/lib/i18n/messages/en/polls";

export type PollMessages = typeof messages;
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

/** The poll string for a dotted key ("voter.heading"), or the key itself when missing. */
export function pt(key: string, vars?: Vars): string {
  return interpolate(lookup(key) ?? key, vars);
}

/** The singular key when count is 1, else the plural key (both get {count}). */
export function ptCount(count: number, one: string, many: string, vars: Vars = {}): string {
  return pt(count === 1 ? one : many, { count, ...vars });
}

export { messages as pollMessages };
