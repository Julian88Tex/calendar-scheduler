// Lifecycle page copy (ARCHITECTURE section 19): a tiny translator over the English "lifecycle-pages" catalog, like the
// booking pages' bt(). Client and server safe. The components import the catalog file directly (not @/lib/i18n, which
// bundles every namespace) to keep the public pages' JavaScript small (GEN-07). Invitee pages are English only
// (docs/SCOPE.md).
import messages from "@/lib/i18n/messages/en/lifecycle-pages";
import { interpolate, type Vars } from "@/components/booking/lib/t";

function lookup(key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** The lifecycle page string for a dotted key ("cancel.heading"), or the key itself when missing. */
export function lt(key: string, vars?: Vars): string {
  return interpolate(lookup(key) ?? key, vars);
}

export { messages as lifecyclePageMessages };
