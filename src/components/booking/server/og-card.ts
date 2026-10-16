// OWNER: booking-pages.
//
// Link preview cards (Open Graph images) for the public pages: what a shared /{handle} or /{handle}/{eventSlug} link
// shows in iMessage, Slack and the like. The card follows the persona the link asks for (?for=, lib/personas.ts): a
// warm persona gets the cream and terracotta card with its greeting and favorites, a classic one the white and blue
// card. Only data the public page itself shows goes on the card: an event type the persona does not list (or a secret
// one, which landing data never holds) falls back to the landing card. Server only.
import "server-only";
import { PERSONA_PARAM } from "@/components/booking/lib/friends";
import { firstNameOf, personaFor, personaLine, type Persona, type PersonaFavorite } from "@/components/booking/lib/personas";
import type { LandingData } from "./landing";
import { loadLanding } from "./landing";
import { loadPersonas } from "./personas";
import { appHost, appUrl } from "@/lib/url";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_PATH = "/api/public/og";

export type OgCard = {
  look: "classic" | "warm";
  /** Small line above the headline. */
  eyebrow: string;
  headline: string;
  body: string | null;
  chips: PersonaFavorite[];
  hostName: string;
  avatarUrl: string | null;
  /** The link's host and path, shown at the bottom ("julendly.vercel.app/julianjoseph"). */
  footer: string;
};

export type OgQuery = { handle: string; persona?: string | null; event?: string | null };

function clip(text: string | null | undefined, max: number): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  // Whole sentences when the first ones fit, so the card never stops mid-thought.
  let out = "";
  for (const s of t.match(/[^.!?]+[.!?]+(\s|$)/g) ?? []) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  return out.trim() || `${t.slice(0, max - 1).trimEnd()}…`;
}

/** The card of a landing page (event null) or of one of its event types, as the given persona. */
export function ogCardOf(data: LandingData, persona: Persona | null, eventSlug: string | null, host = appHost()): OgCard {
  const warm = persona?.style === "warm";
  const first = firstNameOf(data.name);
  const item = eventSlug ? data.items.find((e) => e.slug === eventSlug) : undefined;
  const copy = item && persona && item.personas ? item.personas[persona.id] : undefined;
  const event = item && !(persona && item.personas && !copy) ? { name: copy?.name || item.name, description: copy?.description || item.description, slug: item.slug } : null;
  const path = `/${data.handle}${event ? `/${event.slug}` : ""}`;
  const base = { look: warm ? "warm" : "classic", hostName: data.name, avatarUrl: data.avatarUrl, footer: `${host}${path}` } as const;
  if (event) {
    return {
      ...base,
      eyebrow: warm ? personaLine("pageTitle", first) : data.name,
      headline: clip(event.name, 60) ?? data.name,
      body: clip(event.description, 140),
      chips: [],
    };
  }
  if (warm && persona) {
    return {
      ...base,
      eyebrow: personaLine("landingTitle", first),
      headline: clip(persona.greeting, 40) ?? `Hey there!`,
      body: clip(persona.note, 140),
      chips: persona.favorites.slice(0, 4),
    };
  }
  return {
    ...base,
    eyebrow: persona?.greeting ? data.name : "Book a time",
    headline: clip(persona?.greeting, 40) ?? data.name,
    body: clip(persona?.note || data.welcomeMessage, 140),
    chips: [],
  };
}

/** The card for a query, or null for unknown handles. */
export async function loadOgCard(q: OgQuery): Promise<OgCard | null> {
  const data = await loadLanding(q.handle);
  if (!data) return null;
  const persona = data.kind === "user" ? personaFor(await loadPersonas(data.userId), q.persona ?? undefined) : null;
  return ogCardOf(data, persona, q.event ?? null);
}

/** Absolute URL of the card image for a public page (used in og:image and twitter:image). */
export function ogImageUrl(q: OgQuery): string {
  const params = new URLSearchParams({ handle: q.handle });
  if (q.event) params.set("event", q.event);
  if (q.persona) params.set(PERSONA_PARAM, q.persona);
  return `${appUrl()}${OG_PATH}?${params.toString()}`;
}

/** Open Graph and Twitter image metadata for a public page. */
export function ogImageMeta(q: OgQuery, alt: string) {
  const image = { url: ogImageUrl(q), width: OG_SIZE.width, height: OG_SIZE.height, alt };
  return { images: [image], twitter: { card: "summary_large_image" as const, images: [image.url] } };
}
