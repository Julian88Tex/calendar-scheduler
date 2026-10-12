// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// i18n API (ARCHITECTURE section 19): getT(locale, namespace)(key, vars) with per-key English fallback. Keys are dotted
// paths ("details.title"); placeholders are {name}. Server and client safe: client components receive the namespace
// object they need as props (getMessages) to keep bundles small.
import { CATALOGS, EN_CATALOG, type Catalog, type DeepPartial, type Namespace } from "./catalog";
import { resolveLocale, type Locale } from "./locales";

export { CATALOGS, EN_CATALOG, NAMESPACES, type Catalog, type DeepPartial, type Namespace } from "./catalog";
export { DEFAULT_LOCALE, LOCALES, LOCALE_LABELS, isSupportedLocale, resolveLocale, type Locale } from "./locales";

export type TranslateVars = Record<string, string | number>;
export type Translate = (key: string, vars?: TranslateVars) => string;

function lookup(tree: unknown, key: string): string | undefined {
  let node: unknown = tree;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Replaces {name} placeholders; unknown placeholders stay as written. */
export function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** A translator for one namespace: the locale's string, else English, else the key itself. */
export function getT(locale: string, namespace: Namespace): Translate {
  const loc: Locale = resolveLocale(locale);
  const own = (CATALOGS[loc] as DeepPartial<Catalog>)[namespace];
  const en = EN_CATALOG[namespace];
  return (key, vars) => interpolate(lookup(own, key) ?? lookup(en, key) ?? key, vars);
}

function merge(base: unknown, over: unknown): unknown {
  if (!over || typeof over !== "object") return base;
  if (!base || typeof base !== "object") return over;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = typeof v === "string" ? v : merge(out[k], v);
  return out;
}

/** The namespace object for a locale with English filled in (pass it to client components). */
export function getMessages<N extends Namespace>(locale: string, namespace: N): Catalog[N] {
  const loc = resolveLocale(locale);
  return merge(EN_CATALOG[namespace], (CATALOGS[loc] as DeepPartial<Catalog>)[namespace]) as Catalog[N];
}
