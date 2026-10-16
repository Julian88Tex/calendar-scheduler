// OWNER: foundation-platform.
//
// Persona emails (Settings > Personas, src/components/booking/lib/personas.ts): a booking made through a persona link
// (?for={id}) stores the persona on the invitee (invitees.metadata.persona), and the invitee and guest emails of that
// booking speak as that persona: the event type's name for it, "Schedule again" back to its pages, and for the warm look
// the warm palette and its greeting, thank-you line and sign-off (EmailBrand.persona). Host emails stay classic.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { eventTypes, users } from "@/db/schema";
import { eventPersonasOf, firstNameOf, inviteePersonaOf, personasOf, personaUrl, type Persona } from "@/components/booking/lib/personas";
import type { TemplateContext } from "../template";
import type { EmailBrand } from "./types";

export type EmailPersona = { persona: Persona; eventName: string | null; hostFirstName: string };

/** The persona of a booking (null when it was not booked through a persona, or the persona was since removed). */
export async function emailPersonaFor(p: {
  hostUserId: string | null | undefined;
  eventTypeId: string | null | undefined;
  inviteeMetadata: unknown;
  db?: DbOrTx;
}): Promise<EmailPersona | null> {
  const id = inviteePersonaOf(p.inviteeMetadata);
  if (!id || !p.hostUserId) return null;
  const d = p.db ?? (await getDb());
  const [u] = await d.select({ name: users.name, preferences: users.preferences }).from(users).where(eq(users.id, p.hostUserId)).limit(1);
  if (!u) return null;
  const persona = personasOf(u.preferences).find((x) => x.id === id);
  if (!persona) return null;
  let eventName: string | null = null;
  if (p.eventTypeId) {
    const [et] = await d.select({ slug: eventTypes.slug, metadata: eventTypes.metadata }).from(eventTypes).where(eq(eventTypes.id, p.eventTypeId)).limit(1);
    if (et) eventName = eventPersonasOf(et.metadata, et.slug, u.preferences)[id]?.name || null;
  }
  return { persona, eventName, hostFirstName: firstNameOf(u.name) };
}

/** The brand and template context of an invitee or guest email for the booking's persona (unchanged without one). */
export function applyEmailPersona(brand: EmailBrand, ctx: TemplateContext, p: EmailPersona | null): { brand: EmailBrand; ctx: TemplateContext } {
  if (!p) return { brand, ctx };
  const out: TemplateContext = { ...ctx };
  if (p.eventName) out.event_name = p.eventName;
  const typeUrl = typeof ctx.event_type_url === "string" ? ctx.event_type_url : "";
  if (typeUrl) out.event_type_url = personaUrl(typeUrl, { id: p.persona.id, isDefault: false });
  const warm = p.persona.style === "warm";
  return {
    brand: {
      ...brand,
      // Like the warm public pages, which drop the "Powered by" ribbon.
      showPoweredBy: warm ? false : brand.showPoweredBy,
      persona: warm
        ? { look: "warm", note: p.persona.confirmationNote, signOff: p.persona.signOff, hostFirstName: p.hostFirstName }
        : { look: "classic" },
    },
    ctx: out,
  };
}
