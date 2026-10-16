// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// i18n API (ARCHITECTURE section 19, SPEC GEN-10): getT(locale, namespace)(key, vars) with per-key English fallback
// (the locale's string, else English, else the key itself). Keys are dotted paths ("details.title"); placeholders are
// {name}. Server and client safe: client components receive the namespace object they need as props (getMessages) to
// keep bundles small. Zone names: zoneLabel(zone, locale) uses the `zones` namespace of that locale, then Intl's
// localized generic names ("Mitteleuropaeische Zeit" style), then the English catalog.
import { formatZoneLabel } from "../time/format";
import { CATALOGS, EN_CATALOG, type Catalog, type DeepPartial, type Namespace } from "./catalog";
import { resolveLocale, type Locale } from "./locales";

export { CATALOGS, EN_CATALOG, NAMESPACES, type Catalog, type DeepPartial, type Namespace } from "./catalog";
export {
  DEFAULT_LOCALE,
  INTL_LOCALES,
  LOCALES,
  LOCALE_LABELS,
  intlLocale,
  isSupportedLocale,
  resolveLocale,
  type Locale,
} from "./locales";

export type TranslateVars = Record<string, string | number>;
export type Translate = (key: string, vars?: TranslateVars) => string;

function lookup(tree: unknown, key: string): string | undefined {
  if (!tree || typeof tree !== "object") return undefined;
  // Whole-key match first (zone ids and other keys that are not dotted paths).
  const direct = (tree as Record<string, unknown>)[key];
  if (typeof direct === "string") return direct;
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
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m));
}

function own(loc: Locale, namespace: Namespace): unknown {
  return (CATALOGS[loc] as DeepPartial<Catalog> | undefined)?.[namespace];
}

/** A translator for one namespace: the locale's string, else English, else the key itself. */
export function getT(locale: string | null | undefined, namespace: Namespace): Translate {
  const loc: Locale = resolveLocale(locale);
  const mine = loc === "en" ? undefined : own(loc, namespace);
  const en = EN_CATALOG[namespace];
  return (key, vars) => interpolate(lookup(mine, key) ?? lookup(en, key) ?? key, vars);
}

/** True when the locale itself (not the English fallback) defines the key. */
export function hasTranslation(locale: string | null | undefined, namespace: Namespace, key: string): boolean {
  const loc = resolveLocale(locale);
  return lookup(loc === "en" ? EN_CATALOG[namespace] : own(loc, namespace), key) !== undefined;
}

function merge(base: unknown, over: unknown): unknown {
  if (!over || typeof over !== "object") return base;
  if (!base || typeof base !== "object") return over;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (v && typeof v === "object") out[k] = merge(out[k], v);
  }
  return out;
}

/** The namespace object for a locale with English filled in per key (pass it to client components). */
export function getMessages<N extends Namespace>(locale: string | null | undefined, namespace: N): Catalog[N] {
  const loc = resolveLocale(locale);
  if (loc === "en") return EN_CATALOG[namespace];
  return merge(EN_CATALOG[namespace], own(loc, namespace)) as Catalog[N];
}

/**
 * Zone names a locale defines itself (English: the full catalog; other locales: only their translations, so zones
 * they leave out fall back to Intl's localized names instead of English ones). Pass to formatZoneLabel or the picker.
 */
export function zoneNames(locale: string | null | undefined): Readonly<Record<string, string>> {
  const loc = resolveLocale(locale);
  if (loc === "en") return EN_CATALOG.zones;
  const mine = own(loc, "zones");
  return mine && typeof mine === "object" ? (mine as Record<string, string>) : {};
}

/** Friendly zone label in a locale ("Eastern Time - US & Canada", "Mitteleuropaeische Zeit" style), GEN-10. */
export function zoneLabel(zone: string, locale: string | null | undefined): string {
  const loc = resolveLocale(locale);
  return formatZoneLabel(zone, loc, zoneNames(loc));
}
