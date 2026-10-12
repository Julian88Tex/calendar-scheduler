// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// The message catalog (ARCHITECTURE section 19): every English namespace file (the English files define the key
// types), and for each other locale only its messages/{locale}/index.ts (owned by localization: the aggregate of that
// locale's namespace files, typed DeepPartial<Catalog>), so the catalog compiles before any translation exists and a
// missing key falls back to English. Client safe (plain objects).
import booking from "./messages/en/booking";
import common from "./messages/en/common";
import lifecycle from "./messages/en/lifecycle";
import lifecyclePages from "./messages/en/lifecycle-pages";
import payments from "./messages/en/payments";
import pollEmails from "./messages/en/poll-emails";
import polls from "./messages/en/polls";
import routing from "./messages/en/routing";
import workflows from "./messages/en/workflows";
import zones from "./messages/en/zones";
import de from "./messages/de/index";
import es from "./messages/es/index";
import fr from "./messages/fr/index";
import it from "./messages/it/index";
import nl from "./messages/nl/index";
import pt from "./messages/pt/index";
import uk from "./messages/uk/index";
import type { Locale } from "./locales";

export const EN_CATALOG = {
  common,
  zones,
  booking,
  lifecycle,
  "lifecycle-pages": lifecyclePages,
  polls,
  "poll-emails": pollEmails,
  routing,
  workflows,
  payments,
};

export type Catalog = typeof EN_CATALOG;
export type Namespace = keyof Catalog;

/** Every key optional at every depth; strings stay strings (translations need not repeat the English literal). */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string ? string : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const CATALOGS: Record<Locale, DeepPartial<Catalog>> = { en: EN_CATALOG, fr, es, de, nl, pt, it, uk };

export const NAMESPACES = Object.keys(EN_CATALOG) as Namespace[];
