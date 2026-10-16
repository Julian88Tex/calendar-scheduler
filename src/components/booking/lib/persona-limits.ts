// The ?for= link parameter and the limits of persona settings (lib/personas.ts), on their own so the booking page's
// client code and the event type schemas it loads for previews do not pull in the persona helpers or the warm
// strings (GEN-07). Client and server safe.

/** Query parameter that picks a persona: /{handle}?for={personaId}, carried to event and confirmation pages. */
export const PERSONA_PARAM = "for";

export const PERSONA_LIMITS = { personas: 10, id: 30, short: 80, medium: 160, long: 400, favorites: 6, emoji: 8 } as const;
export const PERSONA_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
