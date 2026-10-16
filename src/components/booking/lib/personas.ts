// Personas of the public booking pages (lib/friends.ts holds the warm theme's fixed strings). A persona is an audience
// the host sets up in Settings > Personas (users.preferences.personas): a link id that picks it from the URL
// (/{handle}?for={id}, carried to the event and confirmation pages), a look ("warm" is the friends theme, "classic"
// the normal page), and the words of its landing page, booking form and confirmation. One persona is the default: links
// without ?for= show it. Each event type chooses which personas see it and how it is named for each of them (Event
// types > Personas, event_types.metadata.personas); types a persona is not enabled for are left off its landing page,
// and their own pages show the plain page.
//
// Before the host saves any personas, the account has two built-in ones: "business" (the default, the plain pages) and
// "friends" (the warm pages, from the old friends mode settings in users.preferences.friends). An event type never
// saved with personas is shown to both: under its real name to the default persona and under the legacy friendly name
// to "friends". Server-side and the settings forms only; kept out of
// lib/friends.ts so the public booking page's client JS does not carry it (GEN-07). Client and server safe.
import { PERSONA_ID_RE, PERSONA_LIMITS, PERSONA_PARAM } from "./persona-limits";
import { interpolate } from "./t";

/** Fixed lines of warm persona pages. {firstName} is the host's first name. The editable ones live on the Persona. */
export const FRIENDS_COPY = {
  landingTitle: "Time with {firstName}",
  pageTitle: "Pick a time with {firstName}",
  empty: "Nothing open with {firstName} right now. Check back soon!",
} as const;

/** utm_source stored on bookings made through a persona link (shown with the meeting's tracking details). */
export function personaUtmSource(personaId: string): string {
  return `${personaId}-link`;
}

/** A public link opened as a persona (?for={id}); the default persona, or none, keeps the plain link. Non-URLs stay as they are. */
export function personaUrl(url: string, persona: Pick<Persona, "id" | "isDefault"> | null | undefined): string {
  if (!persona || persona.isDefault) return url;
  try {
    const u = new URL(url);
    u.searchParams.set(PERSONA_PARAM, persona.id);
    return u.toString();
  } catch {
    return url;
  }
}

/** The persona a booking came through (invitees.metadata.persona, set from ?for= when it was booked), or null. */
export function inviteePersonaOf(metadata: unknown): string | null {
  const v = rec(metadata).persona;
  return typeof v === "string" && v.length <= PERSONA_LIMITS.id && PERSONA_ID_RE.test(v) ? v : null;
}

/** Invitee metadata with the persona key set (an unusable id leaves it off). */
export function withInviteePersona(metadata: Record<string, unknown> | null | undefined, personaId: string | null | undefined): Record<string, unknown> {
  const id = inviteePersonaOf({ persona: (personaId ?? "").trim().toLowerCase() });
  const out: Record<string, unknown> = { ...(metadata ?? {}) };
  delete out.persona;
  if (id) out.persona = id;
  return out;
}

export type PersonaStyle = "warm" | "classic";
export type PersonaFavorite = { emoji: string; label: string };

export type Persona = {
  /** Link id: /{handle}?for={id}. Lowercase letters, digits and dashes. */
  id: string;
  name: string;
  /** Shown by links without ?for=. Exactly one persona is the default. */
  isDefault: boolean;
  style: PersonaStyle;
  /** Landing page heading (empty: the host's name). */
  greeting: string;
  /** Landing page note (classic look, empty: the profile's welcome message). */
  note: string;
  /** Followed by the host's first name (empty: no sign-off line). */
  signOff: string;
  favoritesHeading: string;
  favorites: PersonaFavorite[];
  /** Heading above the event list (empty: none). */
  chooseHeading: string;
  /** Line above the booking form (empty: none). */
  detailsIntro: string;
  /** Thank-you line on the confirmation (empty: none). */
  confirmationNote: string;
};

/** How one event type reads for one persona (empty: the real name or description). */
export type EventPersonaCopy = { name: string; description: string };
/** event_types.metadata.personas: the personas an event type is shown to, by persona id. */
export type EventPersonas = Record<string, EventPersonaCopy>;

export { PERSONA_ID_RE, PERSONA_LIMITS };

export const FRIENDS_PERSONA: Persona = {
  id: "friends",
  name: "Friends",
  isDefault: false,
  style: "warm",
  greeting: "Hey, friend!",
  note: "Really glad you're here. Life gets busy, but time with you is the kind I want to make room for. Pick whatever works and it goes straight on my calendar.",
  signOff: "Can't wait to see you,",
  favoritesHeading: "Things I love doing",
  favorites: [
    { emoji: "🍕", label: "Pizza" },
    { emoji: "☕", label: "Coffee" },
    { emoji: "🚶", label: "Walk and talk" },
    { emoji: "📞", label: "Catch-up call" },
  ],
  chooseHeading: "What sounds good?",
  detailsIntro: "Just tell me who's coming and I'll save the date.",
  confirmationNote: "Seriously, thanks for making the time. It means a lot.",
};

/** A new persona in the settings form: a plain starting point the host rewrites. */
export function blankPersona(id: string, name: string): Persona {
  return { id, name, isDefault: false, style: "classic", greeting: "", note: "", signOff: "", favoritesHeading: "", favorites: [], chooseHeading: "", detailsIntro: "", confirmationNote: "" };
}

/** The built-in default persona: the plain pages. */
export const BUSINESS_PERSONA: Persona = { ...blankPersona("business", "Business"), isDefault: true };

/** Friendly names the built-in friends persona gives event types by slug until they are saved with personas. */
const LEGACY_EVENT_NAMES: Record<string, EventPersonaCopy> = {
  "30min": { name: "Quick video catch-up", description: "Thirty minutes to hear what's new with you." },
  "60min": { name: "Long video chat", description: "A whole hour, no rush. Bring the stories." },
  meal: { name: "Grab pizza (or coffee)", description: "You pick the spot, I bring the appetite." },
};

const TEXT_LIMITS = {
  greeting: PERSONA_LIMITS.short,
  note: PERSONA_LIMITS.long,
  signOff: PERSONA_LIMITS.short,
  favoritesHeading: PERSONA_LIMITS.short,
  chooseHeading: PERSONA_LIMITS.short,
  detailsIntro: PERSONA_LIMITS.medium,
  confirmationNote: PERSONA_LIMITS.medium,
} as const;
const TEXT_KEYS = Object.keys(TEXT_LIMITS) as (keyof typeof TEXT_LIMITS)[];

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A persona link id from free text ("Work friends" -> "work-friends"), or "" when nothing usable is left. */
export function personaIdOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PERSONA_LIMITS.id)
    .replace(/-+$/g, "");
}

function favoritesOf(v: unknown): PersonaFavorite[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(rec)
    .map((f) => ({ emoji: clean(f.emoji, PERSONA_LIMITS.emoji), label: clean(f.label, PERSONA_LIMITS.short) }))
    .filter((f) => f.label)
    .slice(0, PERSONA_LIMITS.favorites);
}

/** One stored persona (any shape), or null when its id is unusable. */
function personaOf(v: unknown): Persona | null {
  const raw = rec(v);
  const id = clean(raw.id, PERSONA_LIMITS.id).toLowerCase();
  if (!PERSONA_ID_RE.test(id)) return null;
  const out: Persona = { ...blankPersona(id, clean(raw.name, PERSONA_LIMITS.short) || id), isDefault: raw.isDefault === true, style: raw.style === "warm" ? "warm" : "classic" };
  for (const k of TEXT_KEYS) out[k] = clean(raw[k], TEXT_LIMITS[k]);
  out.favorites = favoritesOf(raw.favorites);
  return out;
}

/** The legacy friends mode settings (users.preferences.friends) as the built-in friends persona. */
function legacyFriendsPersona(stored: unknown): Persona {
  const raw = rec(stored);
  const out: Persona = { ...FRIENDS_PERSONA };
  for (const k of TEXT_KEYS) out[k] = clean(raw[k], TEXT_LIMITS[k]) || FRIENDS_PERSONA[k];
  if (Array.isArray(raw.favorites)) out.favorites = favoritesOf(raw.favorites);
  return out;
}

/**
 * The host's personas from users.preferences: the saved list (bad entries and repeated ids dropped, exactly one
 * default), or the built-in business and friends personas when none was ever saved.
 */
export function personasOf(preferences: unknown): Persona[] {
  const prefs = rec(preferences);
  if (!Array.isArray(prefs.personas) || prefs.personas.length === 0) return [BUSINESS_PERSONA, legacyFriendsPersona(prefs.friends)];
  const seen = new Set<string>();
  const out: Persona[] = [];
  for (const p of prefs.personas.map(personaOf)) {
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    if (out.length >= PERSONA_LIMITS.personas) break;
  }
  if (out.length === 0) return [BUSINESS_PERSONA, legacyFriendsPersona(prefs.friends)];
  const def = out.find((p) => p.isDefault) ?? out[0]!;
  return out.map((p) => ({ ...p, isDefault: p === def }));
}

/** The default persona (links without ?for=). */
export function defaultPersonaOf(personas: Persona[]): Persona | null {
  return personas.find((p) => p.isDefault) ?? personas[0] ?? null;
}

/** The persona a link asks for (?for={id}); the default one without the parameter or for an unknown id. */
export function personaFor(personas: Persona[], id: string | null | undefined): Persona | null {
  const key = (id ?? "").trim().toLowerCase();
  return (key ? personas.find((p) => p.id === key) : undefined) ?? defaultPersonaOf(personas);
}

/** Legacy friendly names (users.preferences.friends.events) by slug, over the built-in ones. */
function legacyEventNames(preferences: unknown): Record<string, EventPersonaCopy> {
  const events = rec(rec(rec(preferences).friends).events);
  const out: Record<string, EventPersonaCopy> = { ...LEGACY_EVENT_NAMES };
  for (const [slug, e] of Object.entries(events)) {
    const ev = rec(e);
    out[slug.toLowerCase()] = { name: clean(ev.name, PERSONA_LIMITS.short), description: clean(ev.blurb, PERSONA_LIMITS.medium) };
  }
  return out;
}

/**
 * The personas an event type is shown to (event_types.metadata.personas), by persona id. An event type never saved with
 * personas is shown to the default persona under its real name and to the friends persona under its legacy friendly
 * name.
 */
export function eventPersonasOf(metadata: unknown, slug: string, ownerPreferences: unknown): EventPersonas {
  const stored = rec(metadata).personas;
  if (stored === undefined) {
    const def = defaultPersonaOf(personasOf(ownerPreferences));
    const out: EventPersonas = def ? { [def.id]: { name: "", description: "" } } : {};
    out[FRIENDS_PERSONA.id] = legacyEventNames(ownerPreferences)[slug.toLowerCase()] ?? { name: "", description: "" };
    return out;
  }
  const out: EventPersonas = {};
  for (const [id, v] of Object.entries(rec(stored))) {
    if (!PERSONA_ID_RE.test(id)) continue;
    const c = rec(v);
    out[id] = { name: clean(c.name, PERSONA_LIMITS.short), description: clean(c.description, PERSONA_LIMITS.medium) };
  }
  return out;
}

/** Friendly wording of custom questions on warm persona pages, by their exact label. Answers and rules stay the same. */
export const FRIENDLY_QUESTIONS: Record<string, string> = {
  "What would you like to discuss?": "What's new with you? (Anything goes, even just \"hi\")",
};

export function friendlyQuestionLabel(label: string): string {
  return FRIENDLY_QUESTIONS[label.trim()] ?? label;
}

/** A persona page line with {firstName} filled in. */
export function personaLine(key: keyof typeof FRIENDS_COPY, firstName: string): string {
  return interpolate(FRIENDS_COPY[key], { firstName });
}

/** "Julian" from "Julian Joseph" (the whole name when it has one word, "me" when empty). */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "me";
}
