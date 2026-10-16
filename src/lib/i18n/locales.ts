// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Supported invitee-facing locales (SPEC GEN-10, ARCHITECTURE section 19). The dashboard UI is English only.
// Client safe.

export const LOCALES = ["en", "fr", "es", "de", "nl", "pt", "it", "uk"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Native names for language pickers ("pt" is Brazilian Portuguese). */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
  nl: "Nederlands",
  pt: "Português (Brasil)",
  it: "Italiano",
  uk: "Українська",
};

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Maps a BCP 47 tag or Accept-Language style value to a supported locale ("pt-BR" -> "pt", "fr-CA" -> "fr"), else en. */
export function resolveLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE;
  for (const part of value.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase() ?? "";
    const base = tag.split(/[-_]/)[0] ?? "";
    if (isSupportedLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** BCP 47 tags for Intl formatting (dates, weekday and zone names): "pt" is Brazilian Portuguese (GEN-10). */
export const INTL_LOCALES: Record<Locale, string> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
  nl: "nl-NL",
  pt: "pt-BR",
  it: "it-IT",
  uk: "uk-UA",
};

/** The Intl locale tag for a supported locale (or any tag resolved to one): intlLocale("pt") === "pt-BR". */
export function intlLocale(value: string | null | undefined): string {
  return INTL_LOCALES[resolveLocale(value)];
}
